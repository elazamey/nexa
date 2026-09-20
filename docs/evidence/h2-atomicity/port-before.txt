/**
 * Bounded COMMIT executor for the HTTP boundary. Captures and verifies all bytes
 * before mutation; never calls legacy commit(), which re-reads mutable staging.
 * Single-process/exclusive-root contract, not a multi-file atomic transaction.
 */
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalBytes } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { createWorkspaceCommitAuthorizer, denyCommit, WorkspaceCommitError } from './celia-workspace-commit-auth.mjs';

import { createCommitConsumptionStore } from './celia-commit-consumption-store.mjs';

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
        path, content, hash: sha256Multihash(content), size: content.length,
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

/** Local, read-only preparation for an operator; never mints or approves grants. */
export function inspectWorkspaceCommit(input) {
  return captureOrDeny(input).descriptor;
}

export function createWorkspaceCommitter({ root, workspacePort, config = {}, stateDirectory = process.env.CELIA_COMMIT_STATE_DIR }) {
  const base = resolve(root);
  const store = createCommitConsumptionStore({ directory: stateDirectory, targetRoot: workspaceCommitRoot(base), root: base });
  const authorize = createWorkspaceCommitAuthorizer(config, { consumeDurably: envelope => store.consume(envelope) });
  return function commit(input) {
    // No filesystem read/write before identity, capability and policy succeed.
    const authorization = authorize(input);
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
    // No awaits/re-reading staging between verification and application. This
    // excludes interleaving HTTP requests, NOT concurrent external OS writers.
    for (const file of changed) {
      const target = join(base, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { flag: file.base.exists ? 'w' : 'wx', mode: 0o600 });
    }
    return {
      ok: true, workspaceId: input.workspaceId, changedFiles: changed.length,
      changes: changed.map(({ path, hash, size }) => ({ path, hash, size })),
      targetRoot: input.targetRoot, changeSetHash: input.changeSetHash, expectedBaseHash: input.expectedBaseHash,
      subject: authorization.subject, capabilityId: authorization.capabilityId, rule: authorization.rule,
      authorizationRef: authorization.authorizationRef,
    };
  };
}
