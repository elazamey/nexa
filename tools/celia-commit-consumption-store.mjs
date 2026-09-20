/**
 * H1 only: a durable reservation journal, outside the mutable repository root.
 * POSIX local filesystem contract: trusted private directory, exclusive-create
 * lock, append + fsync before effects. No auto-init/reset/recovery on requests.
 * Not a distributed lock, transaction executor, or protection from disk rollback.
 */
import {
  closeSync, constants, fsyncSync, fstatSync, lstatSync, openSync, readFileSync,
  readdirSync, realpathSync, unlinkSync, writeSync,
} from 'node:fs';
import { resolve, sep, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertCapabilityId, assertKid, assertMessageId, assertNonce, canonicalBytes } from '../packages/ast/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { chainLinks } from '../packages/protocol/index.js';
import { WorkspaceCommitError } from './celia-workspace-commit-auth.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const HASH = /^sha256:[A-Za-z0-9_-]{43}$/;
const hash = value => sha256Multihash(canonicalBytes(value));
const unavailable = () => new WorkspaceCommitError(503, 'COMMIT_DURABLE_STATE_UNAVAILABLE');
const check = condition => { if (!condition) throw unavailable(); };

function privateDirectory(directory, root) {
  check(typeof directory === 'string' && directory.length > 0);
  const path = resolve(directory);
  check(typeof root === 'string' && root.length > 0);
  const base = resolve(root);
  const prefix = base.endsWith(sep) ? base : base + sep;
  check(path !== base && !path.startsWith(prefix));
  check(typeof process.getuid === 'function' && realpathSync(path) === path);
  const stat = lstatSync(path);
  check(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  return path;
}
function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function checkedFile(path, flags) {
  const stat = lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_BYTES
    && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  const fd = openSync(path, flags | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    check(opened.dev === stat.dev && opened.ino === stat.ino);
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
function read(path) {
  const fd = checkedFile(path, constants.O_RDONLY);
  try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
}
function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(fd, bytes, offset, bytes.length - offset);
    check(count > 0);
    offset += count;
  }
}
const encode = value => Buffer.from(canonicalBytes(value).toString('utf8') + '\n');

/** Operator provisioning only, to an EMPTY 0700 directory; never overwrite state. */
export function initializeCommitConsumptionStore({ directory, targetRoot, root }) {
  const path = privateDirectory(directory, root);
  check(HASH.test(targetRoot) && readdirSync(path).length === 0);
  const header = { version: 1, kind: 'COMMIT_CONSUMPTION', storeId: randomUUID(), targetRoot };
  for (const [name, value] of [
    ['store.json', header], ['journal.jsonl', header], ['head.json', { count: 0, hash: hash(header) }],
  ]) {
    const fd = openSync(join(path, name), 'wx', 0o600);
    try { writeAll(fd, encode(value)); fsyncSync(fd); } finally { closeSync(fd); }
  }
  syncDirectory(path);
  syncDirectory(dirname(path));
}

function load(directory, targetRoot) {
  const headerText = read(join(directory, 'store.json'));
  const header = JSON.parse(headerText);
  check(header.version === 1 && header.kind === 'COMMIT_CONSUMPTION' && header.targetRoot === targetRoot
    && typeof header.storeId === 'string' && header.storeId.length > 0 && encode(header).toString() === headerText);
  const text = read(join(directory, 'journal.jsonl'));
  check(text.endsWith('\n'));
  const lines = text.slice(0, -1).split('\n');
  check(lines.shift() + '\n' === headerText && lines.length <= MAX_RECORDS);
  const requests = new Set();
  const nonces = new Set();
  const uses = new Map();
  const limits = new Map();
  let prev = hash(header);
  for (let seq = 0; seq < lines.length; seq++) {
    const record = JSON.parse(lines[seq]);
    const { hash: recordedHash, ...unsigned } = record;
    check(record.seq === seq && record.prev === prev && hash(unsigned) === recordedHash && record.kind === 'CONSUMED');
    assertMessageId(record.requestId);
    assertNonce(record.nonce);
    assertKid(record.subject);
    assertKid(record.audience);
    check(HASH.test(record.authorizationRef) && record.scope.targetRoot === targetRoot
      && /^ws_[A-Za-z0-9_-]{1,160}$/.test(record.scope.workspaceId)
      && HASH.test(record.scope.changeSetHash) && HASH.test(record.scope.expectedBaseHash));
    check(!requests.has(record.requestId) && !nonces.has(record.nonce));
    check(Array.isArray(record.grants) && record.grants.length > 0 && record.grants.length <= 16);
    const ids = new Set();
    for (const { id, maxUses } of record.grants) {
      assertCapabilityId(id);
      check(!ids.has(id) && Number.isSafeInteger(maxUses) && maxUses >= 1);
      ids.add(id);
      check(!limits.has(id) || limits.get(id) === maxUses);
      const next = (uses.get(id) ?? 0) + 1;
      check(next <= maxUses);
      uses.set(id, next);
      limits.set(id, maxUses);
    }
    requests.add(record.requestId);
    nonces.add(record.nonce);
    prev = recordedHash;
  }
  const head = JSON.parse(read(join(directory, 'head.json')));
  check(head.count === lines.length && head.hash === prev);
  return { requests, nonces, uses, limits, prev, count: lines.length, bytes: Buffer.byteLength(text) };
}

export function createCommitConsumptionStore({ directory, targetRoot, root }) {
  // Deliberately lazy: an anonymous/default-denied request must not touch storage.
  return {
    consume(envelope) {
      let path;
      let lockFd;
      let release = false;
      try {
        path = privateDirectory(directory, root);
        check(HASH.test(targetRoot));
        try { lockFd = openSync(join(path, 'reservation.lock'), 'wx', 0o600); }
        catch (error) {
          if (error.code === 'EEXIST') throw new WorkspaceCommitError(503, 'COMMIT_DURABLE_STATE_BUSY');
          throw error;
        }
        fsyncSync(lockFd);
        syncDirectory(path);
        const state = load(path, targetRoot); // fresh disk read UNDER the lock
        const grants = chainLinks(envelope.body.capability).map(link => ({ id: link.id, maxUses: link.caveats.max_uses }));
        if (state.requests.has(envelope.id) || state.nonces.has(envelope.nonce)
            || grants.some(({ id, maxUses }) => (state.uses.get(id) ?? 0) >= maxUses
              || (state.limits.has(id) && state.limits.get(id) !== maxUses))) {
          release = true; // a known denial; journal unchanged
          throw new WorkspaceCommitError(403, 'COMMIT_DURABLE_REPLAY_OR_BUDGET_DENIED');
        }
        check(state.count < MAX_RECORDS && new Set(grants.map(grant => grant.id)).size === grants.length);
        const { workspaceId, changeSetHash, expectedBaseHash } = envelope.body.args;
        const unsigned = {
          seq: state.count, prev: state.prev, kind: 'CONSUMED',
          requestId: envelope.id, nonce: envelope.nonce, subject: envelope.from, audience: envelope.to,
          authorizationRef: hash(envelope), scope: { workspaceId, targetRoot, changeSetHash, expectedBaseHash }, grants,
        };
        const record = { ...unsigned, hash: hash(unsigned) };
        const bytes = encode(record);
        check(state.bytes + bytes.length <= MAX_BYTES);
        const fd = checkedFile(join(path, 'journal.jsonl'), constants.O_WRONLY | constants.O_APPEND);
        try {
          writeAll(fd, bytes);
          fsyncSync(fd); // acknowledgement barrier: MUST precede repository writes
        } finally { closeSync(fd); }
        const headFd = checkedFile(join(path, 'head.json'), constants.O_WRONLY | constants.O_TRUNC);
        try {
          writeAll(headFd, encode({ count: state.count + 1, hash: record.hash }));
          fsyncSync(headFd);
        } finally { closeSync(headFd); }
        release = true;
      } catch (error) {
        if (error instanceof WorkspaceCommitError) throw error;
        throw unavailable();
      } finally {
        if (lockFd !== undefined) {
          // On ambiguous I/O/corruption keep the lock: restart must fail closed.
          // Never infer a stale lock is safe merely because its process died.
          try {
            closeSync(lockFd);
            if (release) { unlinkSync(join(path, 'reservation.lock')); syncDirectory(path); }
          } catch { throw unavailable(); }
        }
      }
    },
  };
}
