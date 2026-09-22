/**
 * P03 intent log (write-ahead) for COMMIT, per docs/design/p03-intent-log.md.
 *
 * Contract, deliberately narrow:
 *  - Records digests and identity, NEVER payload bytes. The log can therefore
 *    prove a root is unconfirmed and whether base state is intact; it can never
 *    roll a commit forward.
 *  - `opened` is durable BEFORE the first repository byte is written.
 *  - One active intent per root; an active intent at startup IS an incomplete
 *    transaction.
 *  - `inspectIntent` is a PURE decision over on-disk facts and performs no
 *    writes, so recovery can later move to a separate process.
 *
 * Not a distributed lock, not power-loss durability beyond declared fsync
 * barriers, not protection from disk rollback. POSIX local filesystems only.
 */
import {
  closeSync, constants, fsyncSync, fstatSync, lstatSync, openSync, readFileSync,
  renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalBytes } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { WorkspaceCommitError } from './celia-workspace-commit-auth.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_OPS = 128;
const HASH = /^sha256:[A-Za-z0-9_-]{43}$/;
// 'restoring' is retained only so an intent written by an older build still
// parses; new code uses restore_pending + a child transaction (section 7sexies).
export const INTENT_STATES = Object.freeze(['opened', 'applying', 'restoring', 'restore_pending', 'committed', 'recovered']);
const UNCONFIRMED = Object.freeze(['opened', 'applying', 'restoring', 'restore_pending']);
const CHILD = 'intent-restore.json';
const hash = value => sha256Multihash(canonicalBytes(value));
const unavailable = () => new WorkspaceCommitError(503, 'COMMIT_DURABLE_STATE_UNAVAILABLE');
const check = condition => { if (!condition) throw unavailable(); };
const encode = value => Buffer.from(canonicalBytes(value).toString('utf8') + '\n');

const ACTIVE = 'intent.json';
const ARCHIVE = 'intent-archive.jsonl';

/** Same private-directory contract as the consumption store: outside the root, 0700, owned. */
function privateDirectory(directory, root) {
  check(typeof directory === 'string' && directory.length > 0);
  check(typeof root === 'string' && root.length > 0);
  const path = resolve(directory);
  const base = resolve(root);
  const prefix = base.endsWith(sep) ? base : base + sep;
  check(path !== base && !path.startsWith(prefix));
  check(typeof process.getuid === 'function');
  const stat = lstatSync(path);
  check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  return path;
}
function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(fd, bytes, offset, bytes.length - offset);
    check(count > 0);
    offset += count;
  }
}
function readChecked(path) {
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_BYTES
    && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    check(opened.dev === stat.dev && opened.ino === stat.ino);
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

/**
 * Atomic replace: temp file in the SAME directory, then
 * write -> fsync(file) -> rename -> fsync(directory).
 * A cut before the rename leaves the previous state; a reader never sees a
 * partially written intent.
 */
function atomicWrite(directory, name, value, hooks) {
  const target = join(directory, name);
  const temp = join(directory, `.${name}.${process.pid}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeAll(fd, encode(value));
    hooks?.('before-fsync', { name, state: value.state });
    fsyncSync(fd);
    hooks?.('after-fsync', { name, state: value.state });
  } finally { closeSync(fd); }
  renameSync(temp, target);
  hooks?.('after-rename', { name, state: value.state });
  syncDirectory(directory);
}

function validate(intent) {
  check(intent && intent.version === 1 && intent.kind === 'COMMIT_INTENT');
  check(typeof intent.txId === 'string' && intent.txId.length > 0);
  check(intent.parentTxId === undefined || (typeof intent.parentTxId === 'string' && intent.parentTxId.length > 0));
  check(INTENT_STATES.includes(intent.state));
  check(HASH.test(intent.targetRoot) && HASH.test(intent.changeSetHash)
    && HASH.test(intent.expectedBaseHash) && HASH.test(intent.authorizationRef));
  check(/^ws_[A-Za-z0-9_-]{1,160}$/.test(intent.workspaceId));
  check(Array.isArray(intent.ops) && intent.ops.length > 0 && intent.ops.length <= MAX_OPS);
  for (const op of intent.ops) {
    check(typeof op.path === 'string' && op.path.length > 0 && op.path.length <= 512);
    check(op.fromDigest === null || HASH.test(op.fromDigest));
    check(HASH.test(op.toDigest));
    check(op.mode === null || (Number.isSafeInteger(op.mode) && op.mode >= 0 && op.mode <= 0o7777));
    check(op.applied === undefined || typeof op.applied === 'boolean');
  }
  return intent;
}

/**
 * PURE recovery decision over on-disk facts. Performs no writes and never
 * consults the committer's in-memory state, so it can be verified on its own
 * and later moved into a separate process.
 */
function readIntentFile(path, name, targetRoot) {
  let text;
  try { text = readChecked(join(path, name)); }
  catch (error) {
    if (error.code === 'ENOENT') return { present: false, unconfirmed: false, intent: null };
    throw error;
  }
  let intent;
  try { intent = validate(JSON.parse(text)); }
  catch { // An unreadable intent is the most dangerous state: fail closed.
    return { present: true, unconfirmed: true, unreadable: true, intent: null };
  }
  check(!targetRoot || intent.targetRoot === targetRoot);
  return {
    present: true,
    unconfirmed: UNCONFIRMED.includes(intent.state),
    unreadable: false,
    intent,
    appliedPaths: intent.ops.filter(op => op.applied).map(op => op.path),
  };
}

export function inspectIntent({ directory, root, targetRoot }) {
  const path = privateDirectory(directory, root);
  const parent = readIntentFile(path, ACTIVE, targetRoot);
  const child = readIntentFile(path, CHILD, targetRoot);
  // Rule 2: a child transaction, if present, is what recovery acts on. The
  // parent is reported for diagnosis only.
  return { ...parent, child };
}

/**
 * Conservative recovery of an unconfirmed root, split into a PURE decision and
 * a separate applier so the decision can be verified — and later relocated to
 * another process — without running the committer.
 *
 * The decision is deliberately narrow: recovery is granted ONLY when the log
 * marks no op applied AND every target on disk still carries its recorded
 * fromDigest. That is the provable "nothing happened" case. Anything else —
 * a partially applied transaction, a digest that moved, an unreadable intent —
 * stays blocked for an operator. The log holds digests, never payloads, so it
 * can never roll a commit forward; it can only prove a return to base.
 */
function digestsMatch(ops, digestOf, field) {
  for (const op of ops) {
    let observed;
    try { observed = digestOf(op.path); }
    catch (error) { return { ok: false, reason: `UNREADABLE:${op.path}:${error.code ?? error.message}` }; }
    if (observed !== op[field]) return { ok: false, reason: `MISMATCH:${op.path}`, path: op.path, observed };
  }
  return { ok: true };
}

export function planRecovery(report, digestOf) {
  const child = report.child;
  // Rule 2: when a child restore transaction exists it is the only thing acted
  // on; the parent is ignored entirely until the child is resolved.
  if (child?.present) {
    if (child.unreadable) return { action: 'block', reason: 'RESTORE_INTENT_UNREADABLE' };
    // Rule G: the back-link must name the parent actually on disk.
    if (!report.present || child.intent.parentTxId !== report.intent?.txId) {
      return { action: 'block', reason: 'RESTORE_PARENT_MISSING' };
    }
    // Rule 6: every target must be at base (restored) or at target (not yet
    // restored). Anything else is an unexplained state and is fail-closed.
    const atBase = digestsMatch(child.intent.ops, digestOf, 'toDigest');
    if (atBase.ok) return { action: 'restore_complete', txId: child.intent.txId, parentTxId: report.intent.txId };
    const pending = child.intent.ops.filter(op => !op.applied);
    const unexplained = digestsMatch(pending, digestOf, 'fromDigest');
    if (!unexplained.ok && !unexplained.reason.startsWith('UNREADABLE')) {
      const stillAtBase = digestsMatch([child.intent.ops.find(op => op.path === unexplained.path)], digestOf, 'toDigest');
      if (!stillAtBase.ok) return { action: 'block', reason: 'CORRUPT_RESTORE_STATE' };
    }
    return { action: 'block', reason: 'RESTORE_INCOMPLETE' };
  }
  if (!report.present) return { action: 'none' };
  if (report.unreadable) return { action: 'block', reason: 'INTENT_UNREADABLE' };
  if (!report.unconfirmed) return { action: 'block', reason: 'INTENT_NOT_CLOSED' };
  // Rule 3, corrected. A parent in restore_pending with NO child is ambiguous
  // on its face: the child may have completed and been erased, or the cut may
  // have landed between the parent's state write and the child's creation. The
  // two are told apart by the DISK, never by the absence of a file. Claiming
  // RESTORE_COMPLETED without looking would erase the parent and leave the new
  // bytes on disk with no record that they were ever meant to be rolled back.
  if (report.intent.state === 'restore_pending') {
    const restored = digestsMatch(report.intent.ops, digestOf, 'fromDigest');
    if (restored.ok) return { action: 'clear', txId: report.intent.txId, reason: 'RESTORE_COMPLETED' };
    if (restored.reason.startsWith('UNREADABLE')) return { action: 'block', reason: restored.reason };
    // Still at the applied bytes: no restore ran at all. Keep the parent as the
    // only surviving record and hand the decision to the operator.
    const untouched = digestsMatch(report.intent.ops, digestOf, 'toDigest');
    if (untouched.ok) return { action: 'block', reason: 'RESTORE_SKIPPED_NO_CHILD', txId: report.intent.txId };
    return { action: 'block', reason: 'CORRUPT_RESTORE_STATE' };
  }
  // Rule 7: with the child transaction in place this classification is
  // unreachable for intents written by this build.
  if (report.intent.state === 'restoring') return { action: 'block', reason: 'INTERRUPTED_RESTORE' };
  if (report.appliedPaths.length) return { action: 'block', reason: 'PARTIALLY_APPLIED' };
  const base = digestsMatch(report.intent.ops, digestOf, 'fromDigest');
  if (!base.ok) {
    return { action: 'block', reason: base.reason.startsWith('UNREADABLE') ? base.reason : `BASE_MOVED:${base.path}` };
  }
  return { action: 'clear', txId: report.intent.txId };
}

export function createIntentLog({ directory, root, targetRoot, hooks, digestOf }) {
  const resolveDir = () => privateDirectory(directory, root);
  return {
    /** Durable BEFORE the first repository byte. Refuses if a root is unconfirmed. */
    open({ workspaceId, changeSetHash, expectedBaseHash, authorizationRef, ops }) {
      const path = resolveDir();
      const existing = inspectIntent({ directory, root, targetRoot });
      if (existing.present) {
        // A crashed transaction that provably touched nothing is cleared and
        // archived; every other unconfirmed state stays blocked for an operator.
        const plan = planRecovery(existing, digestOf);
        if (plan.action !== 'clear') {
          const blocked = new WorkspaceCommitError(503, 'COMMIT_RECOVERY_REQUIRED');
          blocked.cause = { reason: plan.reason };
          throw blocked;
        }
        const closed = { ...existing.intent, state: 'recovered', recoveredAt: new Date().toISOString() };
        const fd = openSync(join(path, ARCHIVE), 'a', 0o600);
        try { writeAll(fd, encode(closed)); fsyncSync(fd); } finally { closeSync(fd); }
        unlinkSync(join(path, ACTIVE));
        syncDirectory(path);
      }
      const intent = validate({
        version: 1, kind: 'COMMIT_INTENT', txId: randomUUID(), state: 'opened',
        targetRoot, workspaceId, changeSetHash, expectedBaseHash, authorizationRef,
        ops: ops.map(op => ({ ...op, applied: false })),
        createdAt: new Date().toISOString(),
      });
      atomicWrite(path, ACTIVE, intent, hooks);
      let current = intent;
      return {
        get state() { return current.state; },
        txId: intent.txId,
        advance(state, appliedPath) {
          check(INTENT_STATES.includes(state));
          current = {
            ...current, state,
            ops: current.ops.map(op => (op.path === appliedPath ? { ...op, applied: true } : op)),
          };
          atomicWrite(path, ACTIVE, validate(current), hooks);
        },
        /** Only after post-state verification passed. Erase follows durability. */
        commit() {
          current = { ...current, state: 'committed' };
          atomicWrite(path, ACTIVE, validate(current), hooks);
          hooks?.('before-erase', { state: 'committed' });
          const fd = openSync(join(path, ARCHIVE), 'a', 0o600);
          try { writeAll(fd, encode({ ...current, archivedAt: new Date().toISOString() })); fsyncSync(fd); }
          finally { closeSync(fd); }
          unlinkSync(join(path, ACTIVE));
          syncDirectory(path);
        },
        /**
         * Rule 1/4/5: the parent moves to restore_pending BEFORE a child is
         * opened, and a restore is never opened on a restore.
         */
        openRestore(ops) {
          check(current.state === 'applying'); // rule 4
          check(current.parentTxId === undefined); // rule 5: no restore of a restore
          current = { ...current, state: 'restore_pending' };
          atomicWrite(path, ACTIVE, validate(current), hooks);
          const childIntent = validate({
            version: 1, kind: 'COMMIT_INTENT', txId: randomUUID(), parentTxId: current.txId,
            state: 'opened', targetRoot: current.targetRoot, workspaceId: current.workspaceId,
            changeSetHash: current.changeSetHash, expectedBaseHash: current.expectedBaseHash,
            authorizationRef: current.authorizationRef,
            ops: ops.map(op => ({ ...op, applied: false })),
            createdAt: new Date().toISOString(),
          });
          atomicWrite(path, CHILD, childIntent, hooks);
          let childCurrent = childIntent;
          return {
            txId: childIntent.txId,
            advance(state, appliedPath) {
              check(INTENT_STATES.includes(state));
              childCurrent = {
                ...childCurrent, state,
                ops: childCurrent.ops.map(op => (op.path === appliedPath ? { ...op, applied: true } : op)),
              };
              atomicWrite(path, CHILD, validate(childCurrent), hooks);
            },
            /** Rule 3: the child closes first, then the parent may be erased. */
            complete() {
              childCurrent = { ...childCurrent, state: 'committed' };
              atomicWrite(path, CHILD, validate(childCurrent), hooks);
              const fd = openSync(join(path, ARCHIVE), 'a', 0o600);
              try { writeAll(fd, encode(childCurrent)); fsyncSync(fd); } finally { closeSync(fd); }
              unlinkSync(join(path, CHILD));
              syncDirectory(path);
              hooks?.('child-erased', { txId: childCurrent.txId });
            },
          };
        },
        /** A proven rollback closes the transaction exactly like a commit does. */
        recovered() {
          current = { ...current, state: 'recovered' };
          atomicWrite(path, ACTIVE, validate(current), hooks);
          const fd = openSync(join(path, ARCHIVE), 'a', 0o600);
          try { writeAll(fd, encode({ ...current, archivedAt: new Date().toISOString() })); fsyncSync(fd); }
          finally { closeSync(fd); }
          unlinkSync(join(path, ACTIVE));
          syncDirectory(path);
        },
      };
    },
  };
}

export function intentArchivePath(directory) { return join(resolve(directory), ARCHIVE); }
export function activeIntentPath(directory) { return join(resolve(directory), ACTIVE); }
export { dirname };
