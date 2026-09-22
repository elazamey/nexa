/**
 * P03 test 7 — the restore as its own transaction (section 7sexies).
 *
 * One parametric test over five cut points in the restore lifecycle. The
 * property under test is the package invariant: at any instant there is
 * EXACTLY ONE actionable intent, and a crash during recovery is an ordinary
 * incomplete child rather than the dead-end INTERRUPTED_RESTORE.
 *
 * Acceptance rule from the design: this test is expected to pass on its first
 * run, which is a danger signal. Mutations E (parent left `applying`) and F
 * (parent erased before the child) must kill at least one cut point, or the
 * test measured `restoring` under a new name.
 *
 * Declared limits: no restore of a restore; the child's own atomic-write
 * discipline is a separate contract; classification only, never automatic
 * repair.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { inspectIntent, planRecovery, INTENT_STATES } from '../tools/celia-commit-intent-log.mjs';

const TARGET_ROOT = 'sha256:' + 'A'.repeat(43);
const digest = letter => 'sha256:' + letter.repeat(43);
const BASE = digest('B');
const NEW = digest('N');

function store(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'nexa-p03-restore-'));
  const root = fs.mkdtempSync(join(tmpdir(), 'nexa-p03-root-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  fs.chmodSync(dir, 0o700);
  return { dir, root };
}
const write = (dir, name, value) => fs.writeFileSync(join(dir, name), JSON.stringify(value) + '\n', { mode: 0o600 });

const parentTx = randomUUID();
const childTx = randomUUID();
const intentBase = {
  version: 1, kind: 'COMMIT_INTENT', targetRoot: TARGET_ROOT, workspaceId: 'ws_restore_fixture',
  changeSetHash: digest('C'), expectedBaseHash: digest('E'), authorizationRef: digest('R'),
  createdAt: '2026-09-21T00:00:00.000Z',
};
// The parent applied a.txt (base -> new) and is now rolling back.
const parentIntent = state => ({
  ...intentBase, txId: parentTx, state,
  ops: [{ path: 'a.txt', fromDigest: BASE, toDigest: NEW, mode: 0o640, applied: true }],
});
// The child reverses it: from the new bytes back to base.
const childIntent = (state, applied) => ({
  ...intentBase, txId: childTx, parentTxId: parentTx, state,
  ops: [{ path: 'a.txt', fromDigest: NEW, toDigest: BASE, mode: 0o640, applied }],
});

/**
 * The five cut points, each with the on-disk digest a reader would observe.
 * `expect` is the classification the design requires — never "whatever the
 * implementation happens to return".
 */
const cutPoints = [
  {
    name: 'after parent -> restore_pending, before the child exists',
    parent: parentIntent('restore_pending'), child: null, observed: NEW,
    // Rule 3 read literally: no child means the restore completed. The design
    // accepts this, because the child is written immediately after and a cut
    // between the two leaves the target still at NEW for the operator to see.
    expect: { action: 'clear', reason: 'RESTORE_COMPLETED' },
  },
  {
    name: 'child opened, nothing restored yet',
    parent: parentIntent('restore_pending'), child: childIntent('opened', false), observed: NEW,
    expect: { action: 'block', reason: 'RESTORE_INCOMPLETE' },
  },
  {
    name: 'child applying, target already back at base',
    parent: parentIntent('restore_pending'), child: childIntent('applying', true), observed: BASE,
    expect: { action: 'restore_complete' },
  },
  {
    name: 'child present but the target holds neither base nor new bytes',
    parent: parentIntent('restore_pending'), child: childIntent('applying', false), observed: digest('X'),
    expect: { action: 'block', reason: 'CORRUPT_RESTORE_STATE' },
  },
  {
    name: 'child erased, parent still restore_pending',
    parent: parentIntent('restore_pending'), child: null, observed: BASE,
    expect: { action: 'clear', reason: 'RESTORE_COMPLETED' },
  },
];

for (const cut of cutPoints) {
  test(`P03/7 [${cut.name}]`, t => {
    const s = store(t);
    write(s.dir, 'intent.json', cut.parent);
    if (cut.child) write(s.dir, 'intent-restore.json', cut.child);
    const report = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
    const plan = planRecovery(report, () => cut.observed);
    assert.equal(plan.action, cut.expect.action, `${cut.name}: ${JSON.stringify(plan)}`);
    if (cut.expect.reason) assert.equal(plan.reason, cut.expect.reason, JSON.stringify(plan));
    // Rule 7: with the child transaction in place this must be unreachable.
    assert.notEqual(plan.reason, 'INTERRUPTED_RESTORE',
      'INTERRUPTED_RESTORE is a dead end and must never be produced by the child design');
    // Rule 2: whenever a child exists, the decision is about the child.
    if (cut.child) assert.equal(report.child.present, true);
    t.diagnostic(JSON.stringify({ cut: cut.name, plan }));
  });
}

test('P03/7 rule 5: there is no restore of a restore', t => {
  const s = store(t);
  // A parent that is itself a child must never be rolled back again.
  write(s.dir, 'intent.json', { ...childIntent('applying', true), state: 'applying' });
  const report = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
  assert.equal(report.intent.parentTxId, parentTx, 'fixture must carry a parent link');
  assert.equal(INTENT_STATES.includes('restore_pending'), true);
  t.diagnostic('openRestore refuses a parent that carries parentTxId; asserted at the API in the port tests.');
});

test('P03/7 rule G: a child whose parentTxId names no on-disk parent is fail-closed', t => {
  const s = store(t);
  write(s.dir, 'intent.json', { ...parentIntent('restore_pending'), txId: randomUUID() }); // different parent
  write(s.dir, 'intent-restore.json', childIntent('applying', false));
  const report = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
  assert.equal(planRecovery(report, () => BASE).reason, 'RESTORE_PARENT_MISSING');
  // And with no parent file at all.
  fs.unlinkSync(join(s.dir, 'intent.json'));
  const orphan = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
  assert.equal(planRecovery(orphan, () => BASE).reason, 'RESTORE_PARENT_MISSING');
});

test('P03/7: an unreadable child is fail-closed and never falls through to the parent', t => {
  const s = store(t);
  write(s.dir, 'intent.json', parentIntent('restore_pending'));
  fs.writeFileSync(join(s.dir, 'intent-restore.json'), '{ not json', { mode: 0o600 });
  const report = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
  const plan = planRecovery(report, () => BASE);
  assert.equal(plan.action, 'block');
  assert.equal(plan.reason, 'RESTORE_INTENT_UNREADABLE');
});

/**
 * The fixtures above exercise planRecovery over hand-written files, which does
 * NOT cover the lifecycle that produces them. Mutation E (parent left
 * `applying`) survived that, so these run the REAL createIntentLog lifecycle
 * and assert the package invariant: exactly one actionable intent at a time.
 */
import { createIntentLog, activeIntentPath } from '../tools/celia-commit-intent-log.mjs';

function liveLog(t) {
  const s = store(t);
  const log = createIntentLog({
    directory: s.dir, root: s.root, targetRoot: TARGET_ROOT, digestOf: () => null,
  });
  const tx = log.open({
    workspaceId: 'ws_restore_fixture', changeSetHash: digest('C'), expectedBaseHash: digest('E'),
    authorizationRef: digest('R'),
    ops: [{ path: 'a.txt', fromDigest: BASE, toDigest: NEW, mode: 0o640 }],
  });
  return { ...s, log, tx, read: name => JSON.parse(fs.readFileSync(join(s.dir, name), 'utf8')) };
}

test('P03/7 lifecycle: opening a child moves the parent out of applying first', t => {
  const s = liveLog(t);
  s.tx.advance('applying', 'a.txt');
  assert.equal(s.read('intent.json').state, 'applying');
  const child = s.tx.openRestore([{ path: 'a.txt', fromDigest: NEW, toDigest: BASE, mode: 0o640 }]);
  // MUTATION E kills this: the parent MUST already be restore_pending, so that
  // exactly one intent is actionable and rule 2 can ignore the parent.
  assert.equal(s.read('intent.json').state, 'restore_pending',
    'the parent must leave `applying` BEFORE the child exists');
  assert.equal(s.read('intent-restore.json').parentTxId, s.read('intent.json').txId);
  // With both on disk, recovery acts on the child alone (rule 2).
  const report = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
  assert.equal(report.child.present, true);
  assert.equal(planRecovery(report, () => NEW).reason, 'RESTORE_INCOMPLETE');
  child.complete();
});

test('P03/7 lifecycle: the child is erased before the parent, never the reverse', t => {
  const s = liveLog(t);
  s.tx.advance('applying', 'a.txt');
  const child = s.tx.openRestore([{ path: 'a.txt', fromDigest: NEW, toDigest: BASE, mode: 0o640 }]);
  child.complete();
  // MUTATION F kills this: erasing the parent first would leave an orphan child
  // whose parentTxId names nothing, which rule G must never be reached through.
  assert.equal(fs.existsSync(join(s.dir, 'intent-restore.json')), false, 'the child closes first');
  assert.equal(fs.existsSync(activeIntentPath(s.dir)), true, 'the parent outlives its child');
  assert.equal(s.read('intent.json').state, 'restore_pending');
  // Rule 3: parent in restore_pending with no child means the restore completed.
  const report = inspectIntent({ directory: s.dir, root: s.root, targetRoot: TARGET_ROOT });
  assert.deepEqual(planRecovery(report, () => BASE),
    { action: 'clear', txId: s.read('intent.json').txId, reason: 'RESTORE_COMPLETED' });
  s.tx.recovered();
  assert.equal(fs.existsSync(activeIntentPath(s.dir)), false);
});

test('P03/7 lifecycle: rule 4 and rule 5 are enforced by the API, not by convention', t => {
  const s = liveLog(t);
  // Rule 4: a restore cannot be opened while the parent is still `opened`.
  assert.throws(() => s.tx.openRestore([{ path: 'a.txt', fromDigest: NEW, toDigest: BASE, mode: 0o640 }]),
    error => error.status === 503);
  s.tx.advance('applying', 'a.txt');
  const child = s.tx.openRestore([{ path: 'a.txt', fromDigest: NEW, toDigest: BASE, mode: 0o640 }]);
  // Rule 5: the child exposes no openRestore at all — no restore of a restore.
  assert.equal(typeof child.openRestore, 'undefined');
  child.complete();
});
