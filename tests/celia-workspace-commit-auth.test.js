import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { canonicalBytes, formatInstant } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { workspaceWriteIntent, workspaceWriteResource } from '../tools/celia-workspace-write-auth.mjs';
import { workspaceCommitIntent, workspaceCommitResource, workspaceCommitConstraints } from '../tools/celia-workspace-commit-auth.mjs';
import { inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { snapshot, startIsolatedServer } from './celia-workspace-auth-helpers.mjs';

const options = { timeout: 25_000 };
const changed = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter(key => a.get(key) !== b.get(key)).sort();
const hash = value => sha256Multihash(canonicalBytes(value));
function tree(root) {
  const result = snapshot(root);
  const stat = lstatSync(root, { bigint: true });
  result.set('::root-metadata', ['mode', 'uid', 'gid', 'size', 'ino', 'nlink', 'mtimeNs', 'ctimeNs'].map(k => String(stat[k])).join(','));
  return result;
}
function intentFields({ workspaceId, targetRoot, changeSetHash, expectedBaseHash }) {
  return { workspaceId, targetRoot, changeSetHash, expectedBaseHash };
}

async function fixture(t, { rules, issuers, crossWorkspace = false } = {}) {
  const issuer = createIdentity({ label: 'commit-operator' });
  const caller = createIdentity({ label: 'commit-caller-a' });
  const callerB = createIdentity({ label: 'commit-caller-b' });
  const audience = createIdentity({ label: 'commit-audience' });
  const f = await startIsolatedServer(t, {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{ id: 'stage', effect: 'ALLOW', resource: 'workspace:*', actions: ['write'], subjects: [caller.kid, callerB.kid] }],
  }, {
    audience: audience.kid, capabilityIssuers: issuers ?? [issuer.kid],
    rules: rules ?? [{ id: 'commit-approved-state', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }],
  });
  async function stageWrite(workspace, path, content) {
    const input = { workspaceId: workspace.workspaceId, path, content };
    const token = mintCapability({ issuer, subject: workspace.user.kid, actions: ['write'], resource: workspaceWriteResource(input.workspaceId, path) });
    const authorization = buildEnvelope({
      sender: workspace.user, to: audience.kid, type: 'CALL', capability: token.id,
      body: { resource: token.resource, action: 'write', args: workspaceWriteIntent(input), capability: token },
    });
    const response = await f.post('/api/v1/workspace/write', { ...input, authorization });
    assert.equal(response.status, 200, `authorized staging failed: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.authorizationRef, sha256Multihash(canonicalBytes(authorization)));
    assert.equal(readFileSync(join(workspace.staging, path), 'utf8'), content);
  }
  async function stage(user, suffix) {
    const created = await f.post('/api/v1/workspace/create', { taskId: `commit-auth-${suffix}` });
    assert.equal(created.status, 200);
    const workspaceId = created.body.workspaceId;
    assert.match(workspaceId, /^ws_commit-auth-[ab]_[a-z0-9]+$/);
    const workspace = {
      workspaceId, user, staging: join(f.root, '.nexa', 'staging', workspaceId),
      existing: `commit-${suffix}.txt`, added: `nested-${suffix}/added.txt`,
    };
    writeFileSync(join(f.root, workspace.existing), 'base original\n');
    chmodSync(join(f.root, workspace.existing), 0o640);
    await stageWrite(workspace, workspace.existing, `approved ${suffix}: مرحبًا\n`);
    await stageWrite(workspace, workspace.added, `new approved ${suffix}\n`);
    assert.equal(readFileSync(join(f.root, workspace.existing), 'utf8'), 'base original\n');
    assert.equal(existsSync(join(f.root, workspace.added)), false);
    return workspace;
  }
  const a = await stage(caller, 'a');
  const b = crossWorkspace ? await stage(callerB, 'b') : undefined;
  writeFileSync(join(f.root, 'untouched.txt'), 'not in change set\n');
  const describe = (workspace = a) => intentFields(inspectWorkspaceCommit({ root: f.root, workspaceId: workspace.workspaceId }));
  function capability(input = describe(), overrides = {}) {
    return mintCapability({
      issuer, subject: caller.kid, actions: ['commit'], resource: workspaceCommitResource(input),
      constraints: workspaceCommitConstraints(input),
      caveats: { max_uses: 1, max_depth: 0, exp: formatInstant(Date.now() + 120_000) }, ...overrides,
    });
  }
  function signed(input = describe(), token = capability(input), overrides = {}) {
    const authorization = buildEnvelope({
      sender: caller, to: audience.kid, type: 'CALL', ...(token ? { capability: token.id } : {}),
      body: { action: 'commit', resource: workspaceCommitResource(input), args: workspaceCommitIntent(input), ...(token ? { capability: token } : {}) },
      ...overrides,
    });
    return { ...input, authorization };
  }
  return { ...f, issuer, caller, callerB, audience, a, b, describe, capability, signed, stageWrite, workspaces: b ? [a, b] : [a] };
}

async function denied(f, request, status = 403, code) {
  const metadata = await Promise.all(f.workspaces.map(w => f.get(`/api/v1/workspace/${w.workspaceId}`)));
  const events = (await f.get('/api/v1/events?type=WORKSPACE_COMMIT')).body.events;
  const before = tree(f.root);
  const response = await f.post('/api/v1/workspace/commit', request);
  const after = tree(f.root);
  const afterMetadata = await Promise.all(f.workspaces.map(w => f.get(`/api/v1/workspace/${w.workspaceId}`)));
  const afterEvents = (await f.get('/api/v1/events?type=WORKSPACE_COMMIT')).body.events;
  assert.deepEqual({ status: response.status, ok: response.body.ok, changes: changed(before, after), metadata: afterMetadata, events: afterEvents },
    { status, ok: false, changes: [], metadata, events }, 'DENY must preserve root/staging content, names, mutation metadata, workspace state and commit events');
  if (code) assert.equal(response.body.error, code);
}

// A single controlled ALLOW fixture proves real execution and evidence, not a
// mock that returns success. Every denial below also checks the real filesystem.
test('commit auth: exact approved bytes and base yield only the intended root mutations', options, async t => {
  const f = await fixture(t);
  const request = f.signed();
  const manifest = [f.a.existing, f.a.added].sort().map(path => {
    const content = readFileSync(join(f.a.staging, path));
    return { path, hash: sha256Multihash(content), size: content.length };
  });
  assert.equal(request.changeSetHash, hash({ domain: 'CELIA/commit/changes/v1', files: manifest }));
  assert.equal(request.expectedBaseHash, hash({ domain: 'CELIA/commit/base/v1', files: manifest.map(({ path }) => ({
    path, exists: path === f.a.existing, hash: path === f.a.existing ? sha256Multihash(Buffer.from('base original\n')) : null,
    mode: path === f.a.existing ? 0o640 : null,
  })) }));
  const before = tree(f.root);
  const staged = tree(f.a.staging);
  const response = await f.post('/api/v1/workspace/commit', request);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.changedFiles, 2);
  assert.deepEqual(response.body.changes, manifest);
  assert.equal(response.body.authorizationRef, sha256Multihash(canonicalBytes(request.authorization)));
  for (const { path } of manifest) assert.deepEqual(readFileSync(join(f.root, path)), readFileSync(join(f.a.staging, path)));
  assert.equal(lstatSync(join(f.root, f.a.existing)).mode & 0o7777, 0o640);
  assert.deepEqual(tree(f.a.staging), staged);
  const directory = 'nested-a';
  const allowed = new Set(['::root-metadata', directory, `${directory}::metadata`, ...manifest.flatMap(({ path }) => [path, `${path}::metadata`])]);
  const mutations = changed(before, tree(f.root));
  assert.ok(mutations.includes(f.a.existing) && mutations.includes(f.a.added));
  assert.ok(mutations.every(path => allowed.has(path)), JSON.stringify(mutations));
  const { body } = await f.get('/api/v1/events?type=WORKSPACE_COMMIT');
  assert.equal(body.events.length, 1);
  const event = body.events[0];
  assert.equal(event.hash, response.body.evidenceEventHash);
  assert.equal(event.evidenceRef, response.body.authorizationRef);
  assert.equal(event.payload.subject, f.caller.kid);
  assert.equal(event.payload.capabilityId, request.authorization.cap);
  assert.equal(event.payload.changeSetHash, request.changeSetHash);
  assert.equal(event.payload.expectedBaseHash, request.expectedBaseHash);
  assert.equal(event.payload.rule, 'commit-approved-state');
});

test('commit auth: anonymous is 401 and signed identity without capability is 403', options, async t => {
  const f = await fixture(t);
  await denied(f, { workspaceId: f.a.workspaceId, evidenceRef: 'not-authority' }, 401, 'COMMIT_IDENTITY_REQUIRED');
  await denied(f, f.signed(f.describe(), null), 403, 'COMMIT_CAPABILITY_REQUIRED');
});

test('commit auth: WRITE capability in a signed COMMIT request is not sufficient', options, async t => {
  const f = await fixture(t);
  const input = f.describe();
  const token = mintCapability({ issuer: f.issuer, subject: f.caller.kid, resource: workspaceWriteResource(f.a.workspaceId, f.a.existing), actions: ['write'] });
  await denied(f, f.signed(input, token), 403, 'COMMIT_CAPABILITY_DENIED');
});

test('commit auth: genuine COMMIT grant for A cannot authorize workspace B', options, async t => {
  const f = await fixture(t, { crossWorkspace: true });
  const requestA = f.signed();
  assert.deepEqual(requestA.authorization.body.capability.actions, ['commit']);
  await denied(f, { ...requestA, workspaceId: f.b.workspaceId }, 403, 'COMMIT_INTENT_MISMATCH');
  // Even re-signing B's genuine current descriptor cannot widen A's grant.
  await denied(f, f.signed(f.describe(f.b), requestA.authorization.body.capability), 403, 'COMMIT_CAPABILITY_DENIED');
});

test('commit auth: expired capability in a fresh signed envelope is denied', options, async t => {
  const f = await fixture(t);
  const input = f.describe();
  const past = new Date(Date.now() - 120_000);
  const token = f.capability(input, { now: past, caveats: { nbf: formatInstant(past), exp: formatInstant(Date.now() - 60_000), max_uses: 1, max_depth: 0 } });
  await denied(f, f.signed(input, token), 403, 'COMMIT_CAPABILITY_DENIED');
});

test('commit auth: replay and a new envelope reusing a spent COMMIT grant are denied', options, async t => {
  const f = await fixture(t);
  const request = f.signed();
  assert.equal((await f.post('/api/v1/workspace/commit', request)).status, 200);
  await denied(f, request);
  await denied(f, f.signed(intentFields(request), request.authorization.body.capability));
});

test('commit auth: staging modified via authorized WRITE after approval invalidates COMMIT', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  await f.stageWrite(f.a, f.a.existing, 'a later authorized edit is NOT the approved commit\n');
  await denied(f, approved, 403, 'COMMIT_CHANGE_SET_MISMATCH');
});

test('commit auth: re-signing a new staging hash cannot change the grant constraints', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  await f.stageWrite(f.a, f.a.existing, 'future content\n');
  const next = f.describe();
  assert.notEqual(next.changeSetHash, approved.changeSetHash);
  await denied(f, f.signed(next, approved.authorization.body.capability), 403, 'COMMIT_SCOPE_OR_STATE_DENIED');
});

test('commit auth: added or removed staging files invalidate the full manifest', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  await f.stageWrite(f.a, 'extra.txt', 'not in approved set\n');
  await denied(f, approved, 403, 'COMMIT_CHANGE_SET_MISMATCH');
  rmSync(join(f.a.staging, 'extra.txt'));
  rmSync(join(f.a.staging, f.a.added));
  await denied(f, approved, 403, 'COMMIT_CHANGE_SET_MISMATCH');
});

test('commit auth: changed base content or base permissions invalidates approval', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  writeFileSync(join(f.root, f.a.existing), 'concurrent base change before request\n');
  await denied(f, approved, 403, 'COMMIT_BASE_MISMATCH');
  writeFileSync(join(f.root, f.a.existing), 'base original\n');
  chmodSync(join(f.root, f.a.existing), 0o600);
  await denied(f, approved, 403, 'COMMIT_BASE_MISMATCH');
});

test('commit auth: expected absent target that appears before commit invalidates the base', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  // Use an existing root parent to avoid unrelated setup failure.
  const path = f.a.existing;
  rmSync(join(f.root, path));
  const approvedMissing = f.signed();
  writeFileSync(join(f.root, path), 'appeared after approval\n');
  await denied(f, approvedMissing, 403, 'COMMIT_BASE_MISMATCH');
  assert.notEqual(approved.expectedBaseHash, approvedMissing.expectedBaseHash);
});

test('commit auth: a grant and intent for another root cannot target this server', options, async t => {
  const f = await fixture(t);
  const other = { ...f.describe(), targetRoot: workspaceCommitRoot(join(f.root, 'another-root')) };
  await denied(f, f.signed(other), 403, 'COMMIT_ROOT_MISMATCH');
});

test('commit auth: valid signature and grant cannot bypass empty or denying policy', options, async t => {
  const f = await fixture(t, { rules: [] });
  await denied(f, f.signed(), 403, 'COMMIT_POLICY_DENIED');
});

test('commit auth: untrusted issuer and an empty issuer list fail closed', options, async t => {
  const f = await fixture(t, { issuers: [] });
  await denied(f, f.signed(), 403, 'COMMIT_CAPABILITY_DENIED');
});

test('commit auth: holder, audience, signature and operation are independently checked', options, async t => {
  const f = await fixture(t);
  const input = f.describe();
  const token = f.capability(input);
  await denied(f, f.signed(input, token, { sender: f.callerB }), 403, 'COMMIT_CAPABILITY_DENIED');
  await denied(f, f.signed(input, token, { to: f.callerB.kid }), 403, 'COMMIT_AUDIENCE_DENIED');
  const forged = f.signed(input, token);
  forged.authorization.body.args.workspaceId = 'ws_forged';
  await denied(f, forged, 401, 'COMMIT_IDENTITY_INVALID');
  await denied(f, f.signed(input, token, { body: { resource: token.resource, action: 'write', args: workspaceCommitIntent(input), capability: token } }), 403, 'COMMIT_OPERATION_DENIED');
});

test('commit auth: wrong resource, missing state constraints and wider budgets are denied', options, async t => {
  const f = await fixture(t);
  const input = f.describe();
  await denied(f, f.signed(input, f.capability(input, { resource: 'workspace_commit:other' })), 403, 'COMMIT_CAPABILITY_DENIED');
  await denied(f, f.signed(input, f.capability(input, { constraints: {} })), 403, 'COMMIT_SCOPE_OR_STATE_DENIED');
  await denied(f, f.signed(input, f.capability(input, { caveats: { max_uses: 2, max_depth: 0 } })), 403, 'COMMIT_SCOPE_OR_STATE_DENIED');
});

test('commit auth: root target symlinks are rejected before any file is applied', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  rmSync(join(f.root, f.a.existing));
  symlinkSync(join(f.root, 'untouched.txt'), join(f.root, f.a.existing));
  await denied(f, approved, 403, 'COMMIT_UNSAFE_PATH');
});

test('commit auth: staging symlinks are rejected before any file is applied', options, async t => {
  const f = await fixture(t);
  const approved = f.signed();
  rmSync(join(f.a.staging, f.a.existing));
  symlinkSync(join(f.root, 'untouched.txt'), join(f.a.staging, f.a.existing));
  await denied(f, approved, 403, 'COMMIT_UNSAFE_PATH');
});

test('commit auth: concurrent requests cannot apply the same single-use authorization twice', options, async t => {
  const f = await fixture(t);
  const input = f.describe();
  const token = f.capability(input);
  const responses = await Promise.all([f.signed(input, token), f.signed(input, token)].map(body => f.post('/api/v1/workspace/commit', body)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 403]);
  assert.deepEqual(readFileSync(join(f.root, f.a.existing)), readFileSync(join(f.a.staging, f.a.existing)));
  assert.equal((await f.get('/api/v1/events?type=WORKSPACE_COMMIT')).body.events.length, 1);
});
