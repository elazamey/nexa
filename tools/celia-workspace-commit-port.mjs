/**
 * Bounded COMMIT executor for the HTTP boundary. Captures and verifies all bytes
 * before mutation; never calls legacy commit(), which re-reads mutable staging.
 * H2: compensating rollback for synchronous apply errors under exclusive-root
 * ownership. Not atomic visibility, crash recovery or external-writer protection.
 */
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalBytes } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { createWorkspaceCommitAuthorizer, denyCommit, WorkspaceCommitError } from './celia-workspace-commit-auth.mjs';

import { createCommitConsumptionStore } from './celia-commit-consumption-store.mjs';
import { createIntentLog, inspectIntent } from './celia-commit-intent-log.mjs';
import { createRootLock } from './celia-commit-root-lock.mjs';

// A failed rollback blocks every committer for this root in this process.
// This latch is NOT durable quarantine; restart recovery remains a separate gate.
const recoveryRequiredRoots = new Set();
const EMPTY = Buffer.alloc(0);
const MAX_FILES = 128;
const MAX_BYTES = 8 * 1024 * 1024;
const digest = value => sha256Multihash(canonicalBytes(value));
export const workspaceCommitRoot = root => sha256Multihash(Buffer.from(`CELIA/commit/root/v1\0${resolve(root)}`, 'utf8'));

function safeSegment(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
function directory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) denyCommit('COMMIT_UNSAFE_PATH');
}
function regularFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) denyCommit('COMMIT_UNSAFE_PATH');
  if (stat.size > MAX_BYTES) denyCommit('COMMIT_LIMIT_EXCEEDED');
  return stat;
}
function targetStat(root, path) {
  const parts = path.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) denyCommit('COMMIT_UNSAFE_PATH');
    if (i < parts.length - 1) {
      if (!stat.isDirectory()) denyCommit('COMMIT_UNSAFE_PATH');
    } else {
      return regularFile(current);
    }
  }
}

function capture({ root, workspaceId }) {
  const base = resolve(root);
  if (!/^ws_[A-Za-z0-9_-]{1,160}$/.test(workspaceId)) denyCommit('COMMIT_UNSAFE_PATH');
  if (realpathSync(base) !== base) denyCommit('COMMIT_UNSAFE_PATH');
  directory(base);
  const staging = join(base, '.nexa', 'staging', workspaceId);
  for (const path of [join(base, '.nexa'), join(base, '.nexa', 'staging'), staging]) directory(path);
  const files = [];
  let bytes = 0;
  let baseBytes = 0;
  let entries = 0;
  function walk(relative = '', depth = 0) {
    if (depth > 16) denyCommit('COMMIT_LIMIT_EXCEEDED');
    const names = readdirSync(join(staging, relative)).sort();
    entries += names.length;
    if (entries > 4096) denyCommit('COMMIT_LIMIT_EXCEEDED');
    for (const name of names) {
      if (!safeSegment(name)) denyCommit('COMMIT_UNSAFE_PATH');
      const path = relative ? `${relative}/${name}` : name;
      if (path.length > 512) denyCommit('COMMIT_LIMIT_EXCEEDED');
      const source = join(staging, path);
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) denyCommit('COMMIT_UNSAFE_PATH');
      if (stat.isDirectory()) { walk(path, depth + 1); continue; }
      regularFile(source);
      if (files.length >= MAX_FILES || bytes + stat.size > MAX_BYTES) denyCommit('COMMIT_LIMIT_EXCEEDED');
      const content = readFileSync(source);
      bytes += content.length;
      if (bytes > MAX_BYTES) denyCommit('COMMIT_LIMIT_EXCEEDED');
      const target = targetStat(base, path);
      let previous = null;
      if (target) {
        if (baseBytes + target.size > MAX_BYTES) denyCommit('COMMIT_LIMIT_EXCEEDED');
        previous = readFileSync(join(base, path));
        baseBytes += previous.length;
        if (baseBytes > MAX_BYTES) denyCommit('COMMIT_LIMIT_EXCEEDED');
      }
      files.push({
        path, content, previous, hash: sha256Multihash(content), size: content.length,
        base: { path, exists: target !== null, hash: previous === null ? null : sha256Multihash(previous), mode: target === null ? null : target.mode & 0o7777 },
      });
    }
  }
  walk();
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest = files.map(({ path, hash, size }) => ({ path, hash, size }));
  return {
    files,
    descriptor: {
      workspaceId, targetRoot: workspaceCommitRoot(base),
      changeSetHash: digest({ domain: 'CELIA/commit/changes/v1', files: manifest }),
      expectedBaseHash: digest({ domain: 'CELIA/commit/base/v1', files: files.map(file => file.base) }),
      files: manifest,
    },
  };
}
function captureOrDeny(input) {
  try { return capture(input); } catch (error) {
    if (error instanceof WorkspaceCommitError) throw error;
    denyCommit('COMMIT_STATE_UNAVAILABLE');
  }
}

/** Track only directories actually created by this operation; never recursive removal. */
function ensureParents(base, target, created) {
  const missing = [];
  let parent = dirname(target);
  while (parent !== base) {
    try { directory(parent); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    missing.push(parent);
    parent = dirname(parent);
  }
  for (const path of missing.reverse()) {
    mkdirSync(path); // Record only successful creates, not a competing mkdir.
    created.push(path);
  }
}

/**
 * H3 claim probe. Re-reads the target immediately before truncation and proves
 * it still carries the exact bytes, size and mode that authorization was bound
 * to. The probe itself is non-destructive: it opens no truncating descriptor,
 * so any scheduling point it introduces leaves a competing writer's edit whole.
 * Detection is bytes-equality against the captured base, not a timestamp.
 */
function claimExistingTarget(target, file) {
  // The probe is a real write call, so it occupies the same scheduling point a
  // destructive apply would. 'wx' on an existing path fails with EEXIST without
  // opening a truncating descriptor, so the competitor's bytes survive it.
  let claimed = false;
  try {
    // Empty payload: the probe must never publish commit content at a path the
    // committer is about to refuse, however briefly.
    writeFileSync(target, EMPTY, { flag: 'wx', mode: 0o600 });
    claimed = true; // The verified target vanished; we created a new file.
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (claimed) {
    // A verified-existing target that no longer exists is a concurrent change.
    // Remove only the file this probe just created, then refuse.
    try { unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    throw new WorkspaceCommitError(403, 'COMMIT_CONCURRENT_MODIFICATION');
  }
  // The path still exists. Prove it is the same regular file, mode, size and
  // bytes the base hash was computed over, after every scheduling point above.
  const stat = regularFile(target);
  if ((stat.mode & 0o7777) !== file.base.mode || stat.size !== file.previous.length
      || !readFileSync(target).equals(file.previous)) {
    throw new WorkspaceCommitError(403, 'COMMIT_CONCURRENT_MODIFICATION');
  }
}

/**
 * P02.x post-state verification. A write syscall that did not throw is not
 * proof that the intended bytes are on disk, so every target this operation
 * wrote is re-read from the filesystem and compared against the verified
 * change set. Reads go to disk, never to the buffer the executor still holds.
 *
 * This proves the state re-read AT THIS POINT matched the authorized change
 * set. It is not an independent verifier, and it cannot see an A -> B -> A
 * mutation that is reverted before the read-back. Crash recovery is P03.
 */
function verifyPostState(base, applied) {
  const mismatches = [];
  for (const file of applied) {
    const target = join(base, file.path);
    try {
      const stat = regularFile(target); // also re-checks symlink/nlink/size limits
      if (stat.size !== file.content.length) {
        mismatches.push({ path: file.path, reason: 'SIZE' });
        continue;
      }
      if (!readFileSync(target).equals(file.content)) mismatches.push({ path: file.path, reason: 'BYTES' });
    } catch (error) {
      mismatches.push({ path: file.path, reason: error.code ?? error.message });
    }
  }
  return mismatches;
}

/**
 * Re-read proof that a rollback actually happened. restore() already verifies
 * bytes and mode for files it rewrote, but a deletion path must be proven too:
 * "unlink did not throw" is the same unproven-success problem one level down.
 */
function verifyRestored(base, attempted) {
  const unproven = [];
  for (const file of attempted) {
    const target = join(base, file.path);
    try {
      if (file.base.exists) {
        const stat = regularFile(target);
        if ((stat.mode & 0o7777) !== file.base.mode) unproven.push({ path: file.path, reason: 'MODE' });
        else if (!readFileSync(target).equals(file.previous)) unproven.push({ path: file.path, reason: 'BYTES' });
      } else if (lstatSyncSafe(target)) {
        unproven.push({ path: file.path, reason: 'STILL_PRESENT' });
      }
    } catch (error) {
      unproven.push({ path: file.path, reason: error.code ?? error.message });
    }
  }
  return unproven;
}
function lstatSyncSafe(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Restore attempted files, including a write that partially changed bytes then threw. */
function restore(base, attempted, created) {
  const failures = [];
  for (const file of [...attempted].reverse()) {
    const target = join(base, file.path);
    try {
      let current = null;
      try { regularFile(target); current = readFileSync(target); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (file.base.exists) {
        if (current === null || !current.equals(file.previous)) {
          writeFileSync(target, file.previous, { flag: 'w', mode: file.base.mode });
        }
        // Existing-file writes ignore the mode option and may clear special bits.
        // Restore the captured mode only after the final content write.
        if ((regularFile(target).mode & 0o7777) !== file.base.mode) chmodSync(target, file.base.mode);
        if ((regularFile(target).mode & 0o7777) !== file.base.mode) throw new Error('RESTORE_MODE_MISMATCH');
        if (!readFileSync(target).equals(file.previous)) throw new Error('RESTORE_BYTES_MISMATCH');
      } else if (current !== null) {
        unlinkSync(target); // Exclusive-root contract; external writers remain H3.
      }
    } catch (error) { failures.push({ path: file.path, code: error.code ?? error.message }); }
  }
  for (const path of [...created].reverse()) {
    try { rmdirSync(path); } // A nonempty or replaced directory fails, never rm -rf.
    catch (error) { failures.push({ path, code: error.code ?? error.message }); }
  }
  return failures;
}

/** Local, read-only preparation for an operator; never mints or approves grants. */
export function inspectWorkspaceCommit(input) {
  return captureOrDeny(input).descriptor;
}

export function createWorkspaceCommitter({ root, workspacePort, config = {}, stateDirectory = process.env.CELIA_COMMIT_STATE_DIR, intentHooks }) {
  const base = resolve(root);
  const store = createCommitConsumptionStore({ directory: stateDirectory, targetRoot: workspaceCommitRoot(base), root: base });
  // P03: write-ahead intent. Digests only; it can prove a root is unconfirmed,
  // it can never roll a commit forward. See docs/design/p03-intent-log.md.
  const intentLog = createIntentLog({
    directory: stateDirectory, root: base, targetRoot: workspaceCommitRoot(base), hooks: intentHooks,
    // Recovery compares on-disk truth against recorded digests; a missing file
    // is a real state, not an error, and is reported as null.
    digestOf(relative) {
      const target = join(base, relative);
      try { regularFile(target); }
      catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      return sha256Multihash(readFileSync(target));
    },
  });
  const authorize = createWorkspaceCommitAuthorizer(config, { consumeDurably: envelope => store.consume(envelope) });
  return function commit(input) {
    // No filesystem read/write before identity, capability and policy succeed.
    const authorization = authorize(input);
    if (recoveryRequiredRoots.has(base)) throw new WorkspaceCommitError(503, 'COMMIT_RECOVERY_REQUIRED');
    if (input.targetRoot !== workspaceCommitRoot(base)) denyCommit('COMMIT_ROOT_MISMATCH');
    const workspace = workspacePort._workspaces.get(input.workspaceId);
    if (!workspace || workspace.realPath !== base
        || workspace.stagingPath !== join(base, '.nexa', 'staging', input.workspaceId)) {
      denyCommit('COMMIT_WORKSPACE_DENIED');
    }
    const captured = captureOrDeny({ root: base, workspaceId: input.workspaceId });
    if (captured.descriptor.changeSetHash !== input.changeSetHash) denyCommit('COMMIT_CHANGE_SET_MISMATCH');
    if (captured.descriptor.expectedBaseHash !== input.expectedBaseHash) denyCommit('COMMIT_BASE_MISMATCH');
    const changed = captured.files.filter(file => file.hash !== file.base.hash);
    if (changed.length === 0) denyCommit('COMMIT_NO_CHANGES');
    // Durable isolation is checked AFTER authorization is consumed, never
    // before: a spent grant must still be refused with 403 on an unconfirmed
    // root, so crash state can never mask a replay as a mere 503.
    authorization.consume();
    // Step 5: the root lock is taken AFTER the grant is spent and BEFORE the
    // intent log inspects the root, so no competitor can create an intent
    // between inspection and open. A refusal here spends the grant with nothing
    // written -- a measured signal in the consumption store, not a silent loss.
    const rootLock = createRootLock({ directory: stateDirectory });
    const lockState = rootLock.inspect();
    if (lockState.state === 'contested' || lockState.state === 'awaiting-operator') {
      const contested = new WorkspaceCommitError(503, 'COMMIT_ROOT_CONTESTED');
      contested.cause = { lockState: lockState.state, reason: lockState.reason };
      throw contested;
    }
    if (lockState.state === 'abandoned') rootLock.breakAbandoned();
    let heldLock;
    try { heldLock = rootLock.acquire(); }
    catch (error) {
      if (error.code === 'ROOT_LOCKED') {
        const locked = new WorkspaceCommitError(409, 'COMMIT_ROOT_LOCKED');
        locked.cause = { reason: error.detail?.reason };
        throw locked;
      }
      throw error;
    }
    // Step 9: released on EVERY exit path. A lock leaked on a refusal path
    // holds the root forever -- the same defect class as an intent left open,
    // which P03 already paid for once.
    try {
    // Write-ahead: durable BEFORE the first repository byte. An unconfirmed
    // root refuses here, so a crashed transaction is never silently resumed.
    const transaction = intentLog.open({
      workspaceId: input.workspaceId,
      changeSetHash: input.changeSetHash,
      expectedBaseHash: input.expectedBaseHash,
      authorizationRef: authorization.authorizationRef,
      ops: changed.map(file => ({
        path: file.path, fromDigest: file.base.hash, toDigest: file.hash, mode: file.base.mode,
      })),
    });
    // No awaits/re-reading staging between verification and application. This
    // excludes interleaving HTTP requests, NOT concurrent external OS writers.
    const attempted = [];
    const created = [];
    try {
      for (const file of changed) {
        const target = join(base, file.path);
        ensureParents(base, target, created);
        // H3: the first touch of every existing target is a NON-DESTRUCTIVE
        // claim probe. 'wx' fails with EEXIST before a single byte is altered,
        // so a scheduling point inside this call cannot cost the base bytes.
        // Only after the probe confirms the target still holds the verified
        // base do we truncate. A competing writer is therefore detected while
        // its edit is still intact, and answered with DENY, never an overwrite.
        // Registered before the probe: a probe that fails with a real I/O error
        // may already have altered bytes and must still be rolled back.
        attempted.push(file); // A throwing write may already have truncated/written.
        if (file.base.exists) {
          try { claimExistingTarget(target, file); }
          catch (error) {
            // A refused claim touched nothing, so this target must NOT be
            // restored — restoring it would erase the competing writer's edit.
            if (error instanceof WorkspaceCommitError && error.code === 'COMMIT_CONCURRENT_MODIFICATION') attempted.pop();
            throw error;
          }
        }
        try {
          writeFileSync(target, file.content, { flag: file.base.exists ? 'w' : 'wx', mode: 0o600 });
        } catch (error) {
          // Exclusive creation failed: do not delete a pre-existing competitor's file.
          if (!file.base.exists && error.code === 'EEXIST') attempted.pop();
          throw error;
        }
        transaction.advance('applying', file.path); // durable record of what is now on disk
      }
    } catch (error) {
      // A rollback is itself a transaction with its own durable intent, so a
      // crash DURING recovery is an ordinary incomplete child, not a dead end.
      // Rule 4 holds only once something was actually applied. With no applied
      // target there is nothing to roll back, so no child transaction is opened.
      // A log that cannot record the rollback must not prevent it, and must not
      // replace the original failure with its own. The intent error is carried
      // in the cause and latches the root instead.
      let restoreTx = null;
      let intentError = null;
      if (attempted.length) {
        try {
          restoreTx = transaction.openRestore(attempted.map(file => ({
            path: file.path, fromDigest: file.hash, toDigest: file.base.hash, mode: file.base.mode,
          })));
        } catch (logError) { intentError = logError.code ?? logError.message; }
      }
      if (error instanceof WorkspaceCommitError && error.code === 'COMMIT_CONCURRENT_MODIFICATION') {
        // The stale target set must not be half-applied either: roll back the
        // targets this operation already wrote, then refuse the whole commit.
        const failures = restore(base, attempted, created);
        if (failures.length) {
          recoveryRequiredRoots.add(base);
          const unavailable = new WorkspaceCommitError(503, 'COMMIT_RECOVERY_REQUIRED');
          unavailable.cause = { applyCode: error.code, rollbackFailures: failures };
          throw unavailable;
        }
        if (intentError) {
          recoveryRequiredRoots.add(base);
          const unavailable = new WorkspaceCommitError(503, 'COMMIT_RECOVERY_REQUIRED');
          unavailable.cause = { applyCode: error.code, intentError };
          throw unavailable;
        }
        restoreTx?.complete(); // the child closes first (rule 3)
        transaction.recovered();
        throw error; // 403; authorization stays consumed.
      }
      const failures = restore(base, attempted, created);
      if (failures.length) {
        recoveryRequiredRoots.add(base);
        const unavailable = new WorkspaceCommitError(503, 'COMMIT_RECOVERY_REQUIRED');
        unavailable.cause = { applyCode: error.code ?? error.message, rollbackFailures: failures };
        throw unavailable;
      }
      if (intentError) recoveryRequiredRoots.add(base);
      else { restoreTx?.complete(); transaction.recovered(); }
      // Preserve the original I/O error, and never refund consumed authorization.
      throw error;
    }
    // Effect proof. Until this passes the operation has NOT succeeded, however
    // cleanly every write syscall returned.
    const mismatches = verifyPostState(base, changed);
    if (mismatches.length) {
      // The rollback must happen even if the intent write fails: a log that
      // cannot record recovery must not also prevent it. A failed open is
      // surfaced in the cause, and the root stays latched below.
      let restoreTx = null;
      let intentError = null;
      try {
        restoreTx = transaction.openRestore(changed.map(file => ({
          path: file.path, fromDigest: file.hash, toDigest: file.base.hash, mode: file.base.mode,
        })));
      } catch (error) { intentError = error.code ?? error.message; }
      const failures = restore(base, changed, created);
      // The rollback is itself an unproven success until it is re-read.
      const unproven = failures.length ? failures : verifyRestored(base, changed);
      if (!unproven.length && restoreTx) { restoreTx.complete(); transaction.recovered(); }
      // Latch only when the root's state could not be proven back to base. A
      // proven rollback leaves a consistent root, so later authorized work is
      // refused on its own merits rather than by a blanket 503.
      if (unproven.length || intentError) recoveryRequiredRoots.add(base);
      const code = unproven.length ? 'COMMIT_RECOVERY_UNVERIFIED' : 'COMMIT_EFFECT_UNVERIFIED';
      const unavailable = new WorkspaceCommitError(503, code);
      unavailable.cause = { mismatches, rollbackFailures: failures, unprovenRestores: unproven, intentError };
      throw unavailable;
    }

    // Only now, after the effect is proven, does the transaction close.
    transaction.commit();

    return {
      ok: true, postState: { verified: changed.length, method: 'READ_BACK_SHA256_EQUAL_BYTES' },
      workspaceId: input.workspaceId, changedFiles: changed.length,
      changes: changed.map(({ path, hash, size }) => ({ path, hash, size })),
      targetRoot: input.targetRoot, changeSetHash: input.changeSetHash, expectedBaseHash: input.expectedBaseHash,
      subject: authorization.subject, capabilityId: authorization.capabilityId, rule: authorization.rule,
      authorizationRef: authorization.authorizationRef,
    };
    } finally {
      // Every exit -- return, DENY, 503, or an apply throw -- passes here.
      heldLock.release();
    }
  };
}
