import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { canonicalBytes, formatInstant } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { workspaceWriteIntent, workspaceWriteResource } from '../tools/celia-workspace-write-auth.mjs';
import { snapshot, startIsolatedServer } from './celia-workspace-auth-helpers.mjs';

const options = { timeout: 25_000 };
const changed = (before, after) => [...new Set([...before.keys(), ...after.keys()])]
  .filter(key => before.get(key) !== after.get(key)).sort();

async function fixture(t, { disabled = false, rules, issuers } = {}) {
  const issuer = createIdentity({ label: 'test-write-issuer' });
  const sender = createIdentity({ label: 'test-write-caller' });
  const audience = createIdentity({ label: 'test-write-server' });
  const config = {
    audience: audience.kid, capabilityIssuers: issuers ?? [issuer.kid],
    rules: rules ?? [{ id: 'allow-test-write', effect: 'ALLOW', resource: 'workspace:*', actions: ['write'], subjects: [sender.kid] }],
  };
  const server = await startIsolatedServer(t, disabled ? undefined : config);
  // Only fixture setup uses legacy create. Its authorization is explicitly out
  // of scope; no production auth code is mocked or replaced by this fixture.
  const created = await server.post('/api/v1/workspace/create', { taskId: 'auth-fixture' });
  assert.equal(created.status, 200);
  const workspaceId = created.body.workspaceId;
  assert.match(workspaceId, /^ws_auth-fixture_[a-z0-9]+$/);
  const staging = join(server.root, '.nexa/staging', workspaceId);
  const input = { workspaceId, path: 'canary.txt', content: 'authorized replacement: مرحبًا\n' };
  writeFileSync(join(staging, input.path), 'staged original\n');
  writeFileSync(join(server.root, input.path), 'repository original\n');
  // A second file detects collateral changes/deletions.
  writeFileSync(join(staging, 'untouched.txt'), 'leave this alone\n');

  function capability(target = input, overrides = {}) {
    return mintCapability({
      issuer, subject: sender.kid, resource: workspaceWriteResource(target.workspaceId, target.path),
      actions: ['write'], caveats: { max_uses: 4, max_depth: 0 }, ...overrides,
    });
  }
  function signed(target = input, token = capability(target), overrides = {}) {
    const authorization = buildEnvelope({
      sender, to: audience.kid, type: 'CALL',
      body: {
        resource: workspaceWriteResource(target.workspaceId, target.path), action: 'write',
        args: workspaceWriteIntent(target), ...(token ? { capability: token } : {}),
      },
      ...(token ? { capability: token.id } : {}), ...overrides,
    });
    return { ...target, authorization };
  }
  return { ...server, issuer, sender, audience, staging, input, capability, signed };
}

async function assertDenied(f, input, status = 403, expectedCode) {
  const metadata = await f.get(`/api/v1/workspace/${f.input.workspaceId}`);
  const before = snapshot(f.root);
  const response = await f.post('/api/v1/workspace/write', input);
  const after = snapshot(f.root);
  const afterMetadata = await f.get(`/api/v1/workspace/${f.input.workspaceId}`);
  assert.deepEqual({
    status: response.status, success: response.body.ok === true,
    filesystemChanges: changed(before, after), workspaceMetadata: afterMetadata,
  }, {
    status, success: false, filesystemChanges: [], workspaceMetadata: metadata,
  }, 'denial must preserve files, directories, modes, ownership, mtime/ctime and workspace write counters');
  if (expectedCode) assert.equal(response.body.error, expectedCode);
  return response;
}

test('workspace write auth: anonymous requests preserve filesystem and metadata', options, async t => {
  const f = await fixture(t);
  await assertDenied(f, f.input, 401, 'WORKSPACE_IDENTITY_REQUIRED');
  await assertDenied(f, { ...f.input, path: 'new-directory/new-file.txt' }, 401);
});

test('workspace write auth: a signed identity without a capability is insufficient', options, async t => {
  const f = await fixture(t);
  await assertDenied(f, f.signed(f.input, null), 403, 'WORKSPACE_CAPABILITY_REQUIRED');
});

test('workspace write auth: no server configuration means default deny even with a signed grant', options, async t => {
  const f = await fixture(t, { disabled: true });
  await assertDenied(f, f.signed(), 403, 'WORKSPACE_AUDIENCE_DENIED');
});

test('workspace write auth: a valid capability cannot bypass an empty policy', options, async t => {
  const f = await fixture(t, { rules: [] });
  await assertDenied(f, f.signed(), 403, 'WORKSPACE_POLICY_DENIED');
});

test('workspace write auth: unsigned, forged or stale identity proofs cannot write', options, async t => {
  const f = await fixture(t);
  await assertDenied(f, { ...f.input, authorization: { from: f.sender.kid } }, 401);
  const forged = f.signed();
  forged.authorization.body.args.content = 'tampered signed content';
  await assertDenied(f, forged, 401, 'WORKSPACE_IDENTITY_INVALID');
  await assertDenied(f, f.signed(f.input, f.capability(), { now: new Date(Date.now() - 120_000) }), 401);
});

test('workspace write auth: untrusted issuers and forged capabilities are denied', options, async t => {
  const f = await fixture(t);
  const outsider = createIdentity({ label: 'untrusted-issuer' });
  await assertDenied(f, f.signed(f.input, f.capability(f.input, { issuer: outsider })), 403, 'WORKSPACE_CAPABILITY_DENIED');
  const forged = f.capability();
  forged.proof.val = (forged.proof.val[0] === 'A' ? 'B' : 'A') + forged.proof.val.slice(1);
  await assertDenied(f, f.signed(f.input, forged), 403, 'WORKSPACE_CAPABILITY_DENIED');
});

test('workspace write auth: an empty trusted issuer list denies otherwise valid grants', options, async t => {
  const f = await fixture(t, { issuers: [] });
  await assertDenied(f, f.signed(), 403, 'WORKSPACE_CAPABILITY_DENIED');
});

test('workspace write auth: capability holder and audience are bound to the request', options, async t => {
  const f = await fixture(t);
  const other = createIdentity({ label: 'other-presenter' });
  await assertDenied(f, f.signed(f.input, f.capability(), { sender: other }), 403, 'WORKSPACE_CAPABILITY_DENIED');
  await assertDenied(f, f.signed(f.input, f.capability(), { to: other.kid }), 403, 'WORKSPACE_AUDIENCE_DENIED');
});

test('workspace write auth: exact workspace, path and content are signature-bound', options, async t => {
  const f = await fixture(t);
  const original = f.signed();
  for (const mutation of [
    { content: 'unsigned replacement' }, { path: 'other.txt' }, { workspaceId: 'ws_someone-else' },
  ]) {
    await assertDenied(f, { ...original, ...mutation }, 403, 'WORKSPACE_OPERATION_MISMATCH');
  }
});

test('workspace write auth: wrong scope, wrong action and expired capabilities cannot write', options, async t => {
  const f = await fixture(t);
  await assertDenied(f, f.signed(f.input, f.capability({ ...f.input, path: 'other.txt' })), 403, 'WORKSPACE_CAPABILITY_DENIED');
  await assertDenied(f, f.signed(f.input, f.capability({ ...f.input, workspaceId: 'ws_other' })), 403);
  await assertDenied(f, f.signed(f.input, f.capability(f.input, { actions: ['read'] })), 403);
  const past = new Date(Date.now() - 120_000);
  const token = f.capability(f.input, {
    now: past, caveats: { nbf: formatInstant(past), exp: formatInstant(Date.now() - 60_000), max_uses: 1, max_depth: 0 },
  });
  await assertDenied(f, f.signed(f.input, token), 403, 'WORKSPACE_CAPABILITY_DENIED');
});

test('workspace write auth: ambiguous paths and unenforced constraints fail closed', options, async t => {
  const f = await fixture(t);
  for (const path of ['../canary.txt', '/canary.txt', 'nested/../canary.txt', 'nested//canary.txt', 'nested\\canary.txt']) {
    const target = { ...f.input, path };
    await assertDenied(f, f.signed(target), 400, 'WORKSPACE_INPUT_INVALID');
  }
  await assertDenied(f, f.signed(f.input, f.capability(f.input, { constraints: { max_args_bytes: 1 } })), 403);
  await assertDenied(f, f.signed(f.input, f.capability(f.input, { constraints: { unknown_constraint: 'deny' } })), 403);
});

test('workspace write auth: an issuer-approved caller excluded by policy is denied', options, async t => {
  const f = await fixture(t);
  const other = createIdentity({ label: 'not-on-policy' });
  const token = f.capability(f.input, { subject: other.kid });
  await assertDenied(f, f.signed(f.input, token, { sender: other }), 403, 'WORKSPACE_POLICY_DENIED');
});

test('workspace write auth: authorized HTTP calls really overwrite and create staging files only', options, async t => {
  const f = await fixture(t);
  for (const target of [f.input, { ...f.input, path: 'new-file.txt', content: 'new authorized file\n' }]) {
    const request = f.signed(target);
    const before = snapshot(f.root);
    const response = await f.post('/api/v1/workspace/write', request);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.ok, true);
    assert.equal(response.body.authorizationRef, sha256Multihash(canonicalBytes(request.authorization)));
    assert.equal(readFileSync(join(f.staging, target.path), 'utf8'), target.content);
    const after = snapshot(f.root);
    const file = relative(f.root, join(f.staging, target.path));
    const directory = relative(f.root, f.staging);
    const changes = changed(before, after);
    assert.ok(changes.includes(file), 'the real staged file must change');
    assert.ok(changes.every(key => [file, `${file}::metadata`, `${directory}::metadata`].includes(key)), JSON.stringify(changes));
    assert.equal(readFileSync(join(f.root, 'canary.txt'), 'utf8'), 'repository original\n');
  }
  const status = await f.get(`/api/v1/workspace/${f.input.workspaceId}`);
  assert.equal(status.body.writes, 2);
});

test('workspace write auth: replaying a successful signed write has no second filesystem effect', options, async t => {
  const f = await fixture(t);
  const request = f.signed();
  assert.equal((await f.post('/api/v1/workspace/write', request)).status, 200);
  await assertDenied(f, request, 403, 'WORKSPACE_REPLAY_OR_BUDGET_DENIED');
});

test('workspace write auth: concurrent calls cannot spend a one-use grant twice', options, async t => {
  const f = await fixture(t);
  const token = f.capability(f.input, { caveats: { max_uses: 1, max_depth: 0 } });
  const requests = [f.signed(f.input, token), f.signed(f.input, token)];
  const responses = await Promise.all(requests.map(request => f.post('/api/v1/workspace/write', request)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 403]);
  assert.equal(readFileSync(join(f.staging, f.input.path), 'utf8'), f.input.content);
  assert.equal((await f.get(`/api/v1/workspace/${f.input.workspaceId}`)).body.writes, 1);
  await assertDenied(f, f.signed(f.input, token), 403, 'WORKSPACE_CAPABILITY_DENIED');
});

test('workspace write auth: oversized unauthenticated requests leave files and metadata unchanged', options, async t => {
  const f = await fixture(t);
  await assertDenied(f, { ...f.input, content: 'x'.repeat(128 * 1024) }, 413, 'WORKSPACE_REQUEST_TOO_LARGE');
});
