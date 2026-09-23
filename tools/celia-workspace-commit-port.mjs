/**
 * Bounded COMMIT executor for the HTTP boundary. Captures and verifies all bytes
 * before mutation; never calls legacy commit(), which re-reads mutable staging.
 * H2: compensating rollback for synchronous apply errors under exclusive-root
 * ownership. H3: external-writer protection at the write point — each target is
 * re-verified immediately before AND after a zero-byte reserved write (performed
 * through fs.writeFileSync, the serialization point any writer scheduled at the
 * moment of the write passes through), so a writer that mutates the target at the
 * write point is seen before the approved bytes land; the commit then denies and
 * preserves the external state instead of clobbering it. The reserved write moves
 * no bytes and changes no mtime/ctime, so a denial or kill leaves zero trace.
 * Not crash recovery; under the exclusive-root contract the residual window is the
 * sub-instruction gap between the final check and the fd write.
 */
import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, ftruncateSync,
  lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync,
  rmdirSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalBytes } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { createWorkspaceCommitAuthorizer, denyCommit, WorkspaceCommitError, workspaceCommitResource } from './celia-workspace-commit-auth.mjs';
import { assertKid } from '../packages/ast/index.js';
import { assessClaim, EVIDENCE_SOURCES } from './verification-gate.mjs';

import { createCommitConsumptionStore } from './celia-commit-consumption-store.mjs';

// A failed rollback blocks every committer for this root in this process.
// This latch is NOT durable quarantine; restart recovery remains a separate gate.
const recoveryRequiredRoots = new Set();
const MAX_FILES = 128;
const MAX_BYTES = 8 * 1024 * 1024;
// The zero-byte payload of the write-point reservation write (H3).
const EMPTY_BYTES = new Uint8Array(0);
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

/**
 * Re-verify a target at the moment of the write, not at approval time.
 * Existing: regular, hardlink-unique, bounded and byte-identical to the
 * captured base. New: still absent, or the zero-byte entry our own exclusive
 * create produced in this operation. Any deviation is a base change (403),
 * not an I/O fault: the on-disk state belongs to someone else now.
 */
function verifyBaseAtWrite(base, file) {
  const target = join(base, file.path);
  let stat;
  try { stat = lstatSync(target); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    stat = null;
  }
  if (file.base.exists) {
    if (stat === null || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) {
      denyCommit('COMMIT_BASE_CHANGED');
    }
    if (!readFileSync(target).equals(file.previous)) denyCommit('COMMIT_BASE_CHANGED');
  } else if (stat !== null && (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size !== 0)) {
    // Absent is the expected base; anything present must be the zero-byte
    // entry this operation just created exclusively.
    denyCommit('COMMIT_BASE_CHANGED');
  }
  return stat;
}

/**
 * Apply the approved bytes to an already-verified target through a validated
 * fd: the opened inode must still be the one the fresh stat saw (a
 * rename-replace between check and open is a base change), then write-all,
 * truncate and re-establish the captured permission bits (write/truncate may
 * clear set-user-ID/set-group-ID).
 */
function writeFileBytes(target, file, freshStat) {
  const fd = openSync(target, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== freshStat.dev || opened.ino !== freshStat.ino) denyCommit('COMMIT_BASE_CHANGED');
    let offset = 0;
    while (offset < file.content.length) {
      const written = writeSync(fd, file.content, offset, file.content.length - offset);
      if (written <= 0) throw new Error('COMMIT_SHORT_WRITE');
      offset += written;
    }
    ftruncateSync(fd, file.content.length);
    if (file.base.exists) {
      const mode = fstatSync(fd).mode & 0o7777;
      if (mode !== file.base.mode) fchmodSync(fd, file.base.mode);
    }
  } finally {
    closeSync(fd);
  }
}

/** Local, read-only preparation for an operator; never mints or approves grants. */
export function inspectWorkspaceCommit(input) {
  return captureOrDeny(input).descriptor;
}

/**
 * Verification gate (docs/agent-loop.md): a COMMIT is the DELIVER stage and is
 * reachable only from a PASS verdict. The proposer's own word is never evidence;
 * PASS needs a verified chain signed by a configured verifier key (never the
 * committer itself) whose HANDLER_RESULT/ALLOW is bound to this exact change set.
 * No verifier configured => no COMMIT. Runs after authorization, before any I/O.
 */
const denyVerification = (code, reason) => {
  const error = new WorkspaceCommitError(403, code);
  error.reason = reason;
  throw error;
};
function createVerificationGate(verification) {
  if (verification === undefined) return () => denyCommit('COMMIT_VERIFICATION_UNCONFIGURED');
  if (verification === null || typeof verification !== 'object' || Array.isArray(verification)
      || Object.keys(verification).some(key => key !== 'verifiers')
      || !Array.isArray(verification.verifiers) || verification.verifiers.length === 0) {
    throw new Error('COMMIT verification must be { verifiers: [kid, ...] }');
  }
  for (const kid of verification.verifiers) assertKid(kid);
  const verifiers = new Set(verification.verifiers);
  return function verify(input, subject) {
    const evidence = input.evidence;
    if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)
        || Object.keys(evidence).some(key => !['source', 'records'].includes(key))
        || !EVIDENCE_SOURCES.includes(evidence.source) || !Array.isArray(evidence.records)) {
      denyVerification('COMMIT_VERIFICATION_BLOCKED', 'evidence must be { source: "mock"|"real", records: [...] }');
    }
    const verdict = assessClaim({ claim: { subject, proposer: subject }, records: evidence.records, source: evidence.source });
    if (verdict.verdict !== 'PASS') denyVerification(`COMMIT_VERIFICATION_${verdict.verdict}`, verdict.reason);
    const record = verdict.evidence;
    if (!verifiers.has(record.actor)) denyVerification('COMMIT_VERIFICATION_BLOCKED', 'evidence signer is not a configured verifier');
    if (record.resource !== workspaceCommitResource(input) || record.detail?.changeSetHash !== input.changeSetHash) {
      denyVerification('COMMIT_VERIFICATION_BLOCKED', 'evidence is not bound to this workspace and change set');
    }
    return { verifier: record.actor, evidenceHash: record.hash, evidenceSeq: record.seq };
  };
}

export function createWorkspaceCommitter({ root, workspacePort, config = {}, stateDirectory = process.env.CELIA_COMMIT_STATE_DIR }) {
  const base = resolve(root);
  const store = createCommitConsumptionStore({ directory: stateDirectory, targetRoot: workspaceCommitRoot(base), root: base });
  const { verification, ...authConfig } = config;
  const authorize = createWorkspaceCommitAuthorizer(authConfig, { consumeDurably: envelope => store.consume(envelope) });
  const verify = createVerificationGate(verification);
  return function commit(input) {
    // No filesystem read/write before identity, capability, policy AND the
    // verification gate succeed. AI proposes; the verifier's evidence decides.
    const authorization = authorize(input);
    const verified = verify(input, authorization.subject);
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
    authorization.consume();
    // No awaits anywhere: HTTP requests cannot interleave a synchronous apply.
    // H3 per-target sequence: verify base -> zero-byte reserved write (the write
    // point, through fs.writeFileSync) -> re-verify -> byte apply. The reserved
    // write moves no bytes, so an external writer that acts at exactly the write
    // point survives it; the post-check then sees the foreign bytes BEFORE the
    // approved content lands and the commit denies (403) preserving them.
    const applied = [];
    const created = [];
    let inFlight = null;
    let inFlightTouched = false;
    try {
      for (const file of changed) {
        inFlight = file;
        inFlightTouched = false;
        const target = join(base, file.path);
        ensureParents(base, target, created);
        verifyBaseAtWrite(base, file);
        if (file.base.exists) {
          // r+ must find the existing target; zero bytes clobber nothing.
          inFlightTouched = true;
          writeFileSync(target, EMPTY_BYTES, { flag: 'r+' });
        } else {
          // wx must still be able to create it; from success the entry is ours.
          writeFileSync(target, EMPTY_BYTES, { flag: 'wx', mode: 0o600 });
          inFlightTouched = true;
        }
        writeFileBytes(target, file, verifyBaseAtWrite(base, file));
        applied.push(file);
      }
      inFlight = null;
    } catch (error) {
      // A base-change denial on the in-flight EXISTING target must not restore
      // that target: its on-disk bytes are the external writer's and stay.
      // A new target we created is rolled back to its expected absence.
      const baseChanged = error instanceof WorkspaceCommitError && error.code === 'COMMIT_BASE_CHANGED';
      const restoreList = [...applied];
      if (inFlight !== null && inFlightTouched && !restoreList.includes(inFlight)
          && !(baseChanged && inFlight.base.exists)) {
        restoreList.push(inFlight);
      }
      const failures = restore(base, restoreList, created);
      if (failures.length) {
        recoveryRequiredRoots.add(base);
        const unavailable = new WorkspaceCommitError(503, 'COMMIT_RECOVERY_REQUIRED');
        unavailable.cause = { applyCode: error.code ?? error.message, rollbackFailures: failures };
        throw unavailable;
      }
      // Preserve the original I/O error, and never refund consumed authorization.
      throw error;
    }
    return {
      ok: true, workspaceId: input.workspaceId, changedFiles: changed.length,
      changes: changed.map(({ path, hash, size }) => ({ path, hash, size })),
      targetRoot: input.targetRoot, changeSetHash: input.changeSetHash, expectedBaseHash: input.expectedBaseHash,
      subject: authorization.subject, capabilityId: authorization.capabilityId, rule: authorization.rule,
      authorizationRef: authorization.authorizationRef,
      verification: verified,
    };
  };
}
