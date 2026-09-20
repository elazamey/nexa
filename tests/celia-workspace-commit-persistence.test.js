import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalBytes } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { verifyCapability } from '../packages/capability/index.js';
import { verifyEnvelope } from '../packages/protocol/index.js';
import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { snapshot } from './celia-workspace-auth-helpers.mjs';
import { hardeningFixture } from './celia-commit-hardening-helpers.mjs';

const options = { timeout: 35_000 };
const journal = f => readFileSync(join(f.stateDirectory, 'journal.jsonl'), 'utf8').trimEnd().split('\n').map(JSON.parse);
const assertUnavailable = result => {
  assert.equal(result.outcome, 'ERROR', JSON.stringify(result));
  assert.equal(result.status, 503, JSON.stringify(result));
  assert.deepEqual(result.trace, [], 'no root write attempted');
};
const assertSpent = result => {
  assert.equal(result.outcome, 'DENY', JSON.stringify(result));
  assert.equal(result.status, 403);
  assert.equal(result.code, 'COMMIT_DURABLE_REPLAY_OR_BUDGET_DENIED');
  assert.deepEqual(result.trace, []);
};

// Complements the immutable H1: a new signed envelope is not a new grant, but
// an independently minted valid grant MUST remain usable for identical state.
test('H1 persistence: disk consumption survives ABA/restart; old grant denied, fresh grant same changeSet allowed', options, async t => {
  const f = await hardeningFixture(t);
  assert.equal((await f.commit()).outcome, 'ALLOW');
  assert.deepEqual(f.contents(), f.approved);
  const records = journal(f);
  assert.equal(records.length, 2);
  const record = records[1];
  assert.equal(record.kind, 'CONSUMED');
  assert.equal(record.requestId, f.request.authorization.id);
  assert.equal(record.nonce, f.request.authorization.nonce);
  assert.equal(record.authorizationRef, sha256Multihash(canonicalBytes(f.request.authorization)));
  assert.deepEqual(record.grants, [{ id: f.request.authorization.cap, maxUses: 1 }]);
  const { authorization, ...scope } = f.request;
  assert.deepEqual(record.scope, scope);
  assert.deepEqual(JSON.parse(readFileSync(join(f.stateDirectory, 'head.json'), 'utf8')), { count: 1, hash: record.hash });
  assert.equal(lstatSync(f.stateDirectory).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(f.stateDirectory, 'journal.jsonl')).mode & 0o777, 0o600);
  f.restoreBase();
  const pid = f.pid;
  await f.restart();
  assert.notEqual(f.pid, pid);
  assert.deepEqual(f.describe(), scope);
  verifyEnvelope(authorization, { skewSeconds: 0 });
  const before = snapshot(f.root);
  assertSpent(await f.commit());
  assert.deepEqual(snapshot(f.root), before);

  const reSigned = f.freshRequest(authorization.body.capability);
  assert.notEqual(reSigned.authorization.id, authorization.id);
  assert.notEqual(reSigned.authorization.nonce, authorization.nonce);
  verifyEnvelope(reSigned.authorization, { skewSeconds: 0 });
  assertSpent(await f.commitRequest(reSigned));
  assert.deepEqual(snapshot(f.root), before);
  assert.deepEqual(journal(f), records, 'denials must not add a successful reservation');

  const fresh = f.freshRequest();
  const { authorization: freshAuthorization, ...freshScope } = fresh;
  assert.deepEqual(freshScope, scope);
  assert.notEqual(freshAuthorization.cap, authorization.cap);
  assert.equal((await f.commitRequest(fresh)).outcome, 'ALLOW');
  assert.deepEqual(f.contents(), f.approved);
  assert.equal(journal(f).length, 3);
  t.diagnostic(JSON.stringify({ oldPid: pid, restartedPid: f.pid, oldAuthorization: 'DENY', reSignedSpentGrant: 'DENY', freshGrantSameState: 'ALLOW', durableConsumptions: 2 }));
});

test('H1 persistence: SIGKILL after durable consume but before first root effect cannot revive authority', options, async t => {
  const f = await hardeningFixture(t, { fault: 'kill-before-root' });
  const before = snapshot(f.root);
  const pid = f.pid;
  await assert.rejects(f.commit(), /Boundary exited \(null\/SIGKILL\)/);
  assert.deepEqual(snapshot(f.root), before, 'consumption preceded EVERY target effect');
  assert.equal(journal(f)[1].requestId, f.request.authorization.id);
  assert.equal(existsSync(join(f.stateDirectory, 'reservation.lock')), false, 'completed reservation, not stale-lock denial');
  await f.restart();
  assert.notEqual(f.pid, pid);
  verifyEnvelope(f.request.authorization, { skewSeconds: 0 });
  assertSpent(await f.commit());
  assert.deepEqual(snapshot(f.root), before);
  assert.equal((await f.commitRequest(f.freshRequest())).outcome, 'ALLOW');
  assert.deepEqual(f.contents(), f.approved);
});

test('H1 persistence: shared ancestor budgets persist, without banning an unspent sibling grant', options, async t => {
  const f = await hardeningFixture(t);
  const { parent, requests } = f.delegatedRequests(2, 3);
  for (let i = 0; i < 2; i++) {
    assert.equal((await f.commitRequest(requests[i])).outcome, 'ALLOW');
    f.restoreBase();
    await f.restart();
  }
  const third = requests[2];
  verifyEnvelope(third.authorization, { skewSeconds: 0 });
  verifyCapability(third.authorization.body.capability, {
    presenter: third.authorization.from, trustedIssuers: [parent.issuer], resource: parent.resource, action: 'commit',
  }); // valid cryptography, time, scope; only the stored parent budget is spent
  const before = snapshot(f.root);
  assertSpent(await f.commitRequest(third));
  assert.deepEqual(snapshot(f.root), before);
  const records = journal(f).slice(1);
  assert.equal(records.length, 2);
  for (const record of records) assert.ok(record.grants.some(grant => grant.id === parent.id && grant.maxUses === 2));
});

for (const fault of ['journal-write-error', 'journal-fsync-error', 'head-fsync-error']) {
  test(`H1 persistence: ${fault} fails closed before root effects and stays closed after restart`, options, async t => {
    const f = await hardeningFixture(t, { fault });
    const before = snapshot(f.root);
    const result = await f.commit();
    assertUnavailable(result);
    assert.equal(result.code, 'COMMIT_DURABLE_STATE_UNAVAILABLE');
    assert.deepEqual(snapshot(f.root), before);
    assert.ok(existsSync(join(f.stateDirectory, 'reservation.lock')), 'uncertain reservation is not silently cleared');
    await f.restart();
    const retried = await f.commit();
    assertUnavailable(retried);
    assert.equal(retried.code, 'COMMIT_DURABLE_STATE_BUSY');
    assertUnavailable(await f.commitRequest(f.freshRequest()));
    assert.deepEqual(snapshot(f.root), before);
  });
}

const corruptions = {
  'missing initialization': f => { for (const name of ['store.json', 'journal.jsonl', 'head.json']) rmSync(join(f.stateDirectory, name)); },
  'missing journal': f => rmSync(join(f.stateDirectory, 'journal.jsonl')),
  'torn record': f => truncateSync(join(f.stateDirectory, 'journal.jsonl'), lstatSync(join(f.stateDirectory, 'journal.jsonl')).size - 3),
  'whole-record journal truncation': f => {
    const lines = readFileSync(join(f.stateDirectory, 'journal.jsonl'), 'utf8').trimEnd().split('\n');
    writeFileSync(join(f.stateDirectory, 'journal.jsonl'), lines[0] + '\n');
  },
  'corrupted head': f => writeFileSync(join(f.stateDirectory, 'head.json'), '{}\n'),
  'non-private directory': f => chmodSync(f.stateDirectory, 0o755),
  'unwritable journal': f => chmodSync(join(f.stateDirectory, 'journal.jsonl'), 0o400),
  'unreadable journal': f => chmodSync(join(f.stateDirectory, 'journal.jsonl'), 0o200),
  'symlink journal': f => {
    rmSync(join(f.stateDirectory, 'journal.jsonl'));
    symlinkSync(join(f.stateDirectory, 'store.json'), join(f.stateDirectory, 'journal.jsonl'));
  },
  'wrong root binding': f => {
    const path = join(f.stateDirectory, 'store.json');
    const header = JSON.parse(readFileSync(path, 'utf8'));
    header.targetRoot = sha256Multihash(Buffer.from('different root'));
    writeFileSync(path, canonicalBytes(header).toString() + '\n');
  },
};
for (const [name, corrupt] of Object.entries(corruptions)) {
  test(`H1 persistence: ${name} is never treated as a fresh empty ledger`, options, async t => {
    const f = await hardeningFixture(t);
    assert.equal((await f.commit()).outcome, 'ALLOW');
    f.restoreBase();
    corrupt(f);
    await f.restart();
    const before = snapshot(f.root);
    assertUnavailable(await f.commitRequest(f.freshRequest()));
    assertUnavailable(await f.commit());
    assert.deepEqual(snapshot(f.root), before);
  });
}

test('H1 persistence: missing store on the FIRST authorized request denies rather than silently initializing', options, async t => {
  const f = await hardeningFixture(t, { provision: false });
  const before = snapshot(f.root);
  assertUnavailable(await f.commit());
  assert.equal(existsSync(join(f.stateDirectory, 'journal.jsonl')), false);
  assert.deepEqual(snapshot(f.root), before);
});

test('H1 persistence: provisioning refuses reset of an existing consumed store', options, async t => {
  const f = await hardeningFixture(t);
  assert.equal((await f.commit()).outcome, 'ALLOW');
  assert.throws(() => initializeCommitConsumptionStore({ directory: f.staging, root: f.root, targetRoot: f.request.targetRoot }), 'authority store must not live inside the target root');
  const before = snapshot(f.stateDirectory);
  assert.throws(() => initializeCommitConsumptionStore({ directory: f.stateDirectory, root: f.root, targetRoot: f.request.targetRoot }));
  assert.deepEqual(snapshot(f.stateDirectory), before);
});


test('H1 persistence: absent state-directory configuration has no in-memory fallback', options, async t => {
  const f = await hardeningFixture(t, { configured: false });
  const rootBefore = snapshot(f.root);
  const storeBefore = snapshot(f.stateDirectory);
  assertUnavailable(await f.commit());
  assert.deepEqual(snapshot(f.root), rootBefore);
  assert.deepEqual(snapshot(f.stateDirectory), storeBefore);
});

test('H1 persistence: anonymous denial does not mutate the consumption store', options, async t => {
  const f = await hardeningFixture(t);
  const rootBefore = snapshot(f.root);
  const storeBefore = snapshot(f.stateDirectory);
  const result = await f.commitRequest({ ...f.request, authorization: undefined });
  assert.equal(result.status, 401);
  assert.deepEqual(snapshot(f.root), rootBefore);
  assert.deepEqual(snapshot(f.stateDirectory), storeBefore);
});
