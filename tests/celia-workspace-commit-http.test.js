import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability, verifyCapability } from '../packages/capability/index.js';
import { buildEnvelope, verifyEnvelope } from '../packages/protocol/index.js';
import { canonicalBytes, formatInstant } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { workspaceWriteIntent, workspaceWriteResource } from '../tools/celia-workspace-write-auth.mjs';
import { snapshot, startIsolatedServer } from './celia-workspace-auth-helpers.mjs';

const options = { timeout: 25_000 };
const changes = (before, after) => [...new Set([...before.keys(), ...after.keys()])]
  .filter(key => before.get(key) !== after.get(key)).sort();

function directoryMetadata(path) {
  const stat = lstatSync(path, { bigint: true });
  // Include the directory itself, not just its children. Exclude atime because
  // reading snapshots can update it; do compare mutation times and ownership.
  return ['mode', 'uid', 'gid', 'size', 'ino', 'nlink', 'mtimeNs', 'ctimeNs']
    .map(key => [key, stat[key].toString()]);
}

async function fixture(t, { crossWorkspace = false } = {}) {
  const issuer = createIdentity({ label: 'commit-red-issuer' });
  const userA = createIdentity({ label: 'commit-red-user-a' });
  const userB = createIdentity({ label: 'commit-red-user-b' });
  const audience = createIdentity({ label: 'commit-red-server' });
  // Enable only the existing WRITE boundary. No COMMIT authority is configured,
  // mocked or granted by this fixture.
  const server = await startIsolatedServer(t, {
    audience: audience.kid, capabilityIssuers: [issuer.kid],
    rules: [{
      id: 'allow-fixture-write', effect: 'ALLOW', resource: 'workspace:*',
      actions: ['write'], subjects: [userA.kid, userB.kid],
    }],
  });

  async function stage(user, label) {
    // Legacy create is setup only, not proof that create is authorized.
    const created = await server.post('/api/v1/workspace/create', { taskId: label });
    assert.equal(created.status, 200, 'fixture must create an existing workspace');
    assert.equal(created.body.ok, true);
    const { workspaceId } = created.body;
    assert.match(workspaceId, new RegExp(`^ws_${label}_[a-z0-9]+$`));
    const staging = join(server.root, '.nexa', 'staging', workspaceId);
    const existing = `${label}-existing.txt`;
    const added = `${label}-added.txt`;
    writeFileSync(join(server.root, existing), 'root original\n');
    assert.equal(existsSync(join(server.root, added)), false);
    const operations = [];

    for (const path of [existing, added]) {
      const input = { workspaceId, path, content: `staged by ${label}: ${path}\n` };
      const token = mintCapability({
        issuer, subject: user.kid, resource: workspaceWriteResource(workspaceId, path),
        actions: ['write'],
        caveats: { max_uses: 3, max_depth: 0, exp: formatInstant(Date.now() + 120_000) },
      });
      const signWrite = () => buildEnvelope({
        sender: user, to: audience.kid, type: 'CALL', capability: token.id,
        body: { resource: token.resource, action: 'write', args: workspaceWriteIntent(input), capability: token },
      });
      const authorization = signWrite();
      const result = await server.post('/api/v1/workspace/write', { ...input, authorization });
      assert.equal(result.status, 200, `authorized WRITE setup failed: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.authorizationRef, sha256Multihash(canonicalBytes(authorization)));
      assert.equal(readFileSync(join(staging, path), 'utf8'), input.content);
      operations.push({ input, token, signWrite, usedEnvelope: authorization });
    }
    assert.equal(readFileSync(join(server.root, existing), 'utf8'), 'root original\n');
    assert.equal(existsSync(join(server.root, added)), false, 'WRITE must not promote a new file to root');
    const status = await server.get(`/api/v1/workspace/${workspaceId}`);
    assert.equal(status.body.writes, 2);
    assert.equal(status.body.changesCount, 2);
    return { workspaceId, staging, operations, user };
  }

  const a = await stage(userA, 'commit-red-a');
  const b = crossWorkspace ? await stage(userB, 'commit-red-b') : undefined;
  writeFileSync(join(server.root, 'unrelated-canary.txt'), 'must remain untouched\n');
  return { ...server, issuer, audience, a, b, workspaces: b ? [a, b] : [a] };
}

function freshWriteAuthorization(f, workspace) {
  const operation = workspace.operations[0];
  const envelope = operation.signWrite();
  // Separate operation confusion from replay/expiry: this is a FRESH valid
  // WRITE envelope and its grant still has a use budget. Never mint COMMIT here.
  assert.notEqual(envelope.id, operation.usedEnvelope.id);
  assert.notEqual(envelope.nonce, operation.usedEnvelope.nonce);
  verifyEnvelope(envelope, { expectSender: workspace.user.kid, expectRecipient: f.audience.kid, allowedTypes: ['CALL'] });
  verifyCapability(operation.token, {
    presenter: workspace.user.kid, trustedIssuers: [f.issuer.kid],
    resource: operation.token.resource, action: 'write', uses: () => 1,
  });
  assert.deepEqual(operation.token.actions, ['write']);
  return envelope;
}

async function assertCommitDenied(t, f, request, allowedStatuses) {
  const beforeStatus = await Promise.all(f.workspaces.map(w => f.get(`/api/v1/workspace/${w.workspaceId}`)));
  const before = snapshot(f.root);
  const rootMetadata = directoryMetadata(f.root);
  const staged = f.workspaces.map(w => ({ files: snapshot(w.staging), metadata: directoryMetadata(w.staging) }));

  const response = await f.post('/api/v1/workspace/commit', request);

  const after = snapshot(f.root);
  const afterRootMetadata = directoryMetadata(f.root);
  const stagingChanges = f.workspaces.map((w, i) => ({
    workspaceId: w.workspaceId,
    changedEntries: changes(staged[i].files, snapshot(w.staging)),
    metadataUnchanged: JSON.stringify(staged[i].metadata) === JSON.stringify(directoryMetadata(w.staging)),
  }));
  const afterStatus = await Promise.all(f.workspaces.map(w => f.get(`/api/v1/workspace/${w.workspaceId}`)));
  const filesystemChanges = changes(before, after);
  t.diagnostic(JSON.stringify({ status: response.status, reportedChangedFiles: response.body.changedFiles, filesystemChanges, stagingChanges }));
  // These are the desired DENY semantics, intentionally RED on legacy commit.
  // A 404/500, an empty workspace, or denial AFTER copying must not count as PASS.
  assert.deepEqual({
    denied: allowedStatuses.includes(response.status), reportsSuccess: response.body.ok === true,
    filesystemChanges, rootMetadata: afterRootMetadata, stagingChanges, workspaceMetadata: afterStatus,
  }, {
    denied: true, reportsSuccess: false, filesystemChanges: [], rootMetadata,
    stagingChanges: f.workspaces.map(w => ({ workspaceId: w.workspaceId, changedEntries: [], metadataUnchanged: true })),
    workspaceMetadata: beforeStatus,
  }, 'COMMIT needs independent authority; denial must leave root, staging and workspace metadata unchanged');
}

test('workspace commit HTTP: anonymous commit cannot promote authorized staged writes', options, async t => {
  const f = await fixture(t);
  await assertCommitDenied(t, f, { workspaceId: f.a.workspaceId }, [401, 403]);
});

test('workspace commit HTTP: a fresh signed WRITE grant is not COMMIT permission', options, async t => {
  const f = await fixture(t);
  await assertCommitDenied(t, f, {
    workspaceId: f.a.workspaceId, authorization: freshWriteAuthorization(f, f.a),
  }, [403]);
});

test('workspace commit HTTP: user A WRITE grant cannot commit user B staged workspace', options, async t => {
  const f = await fixture(t, { crossWorkspace: true });
  assert.notEqual(f.a.workspaceId, f.b.workspaceId);
  assert.notEqual(f.a.user.kid, f.b.user.kid);
  await assertCommitDenied(t, f, {
    workspaceId: f.b.workspaceId, authorization: freshWriteAuthorization(f, f.a),
  }, [403]);
});
