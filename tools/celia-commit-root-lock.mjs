/**
 * Root lock for package 8 — one lock per root, separate from the consumption
 * lock (two hazards, two locks; see docs/design/p03-intent-log.md 8bis.1).
 *
 * Design decisions this file implements, all fixed before it was written:
 *
 * - Taken with `link()`, never `O_EXCL`. The metadata is written to a temp file
 *   first, so the lock name is either absent or complete. `O_EXCL` would leave
 *   a window where the lock exists empty, and an empty lock cannot be told
 *   apart from a holder mid-write (8bis.2b).
 * - An expired TTL is an ALARM, not a verdict. A frozen process is alive.
 *   TTL expiry leads to `contested`, never to a break (8bis.3).
 * - Only the total absence of the holder proves `abandoned`.
 * - Dead-lock detection is Linux-only. Anywhere liveness cannot be proven, an
 *   expired lock is `awaiting-operator`.
 * - `held -> freeing` and `contested -> freeing` are forbidden transitions and
 *   are asserted, not merely avoided.
 */
import { writeFileSync, linkSync, unlinkSync, readFileSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:process';

export const LOCK_NAME = 'commit.lock';
export const STALE_RECOVERY_NAME = 'lock-stale-recovery.json';
export const DEFAULT_TTL_MS = 30_000;

export const LOCK_STATES = Object.freeze([
  'free', 'held', 'contested', 'abandoned', 'awaiting-operator', 'freeing', 'freed',
]);

class LockError extends Error {
  constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

/**
 * Whether this platform can PROVE a process is absent. A check that cannot see
 * the process and therefore reports "absent" is a proof that verifies and means
 * nothing (principles P1), so we refuse to pretend.
 */
export function livenessProvable() {
  return platform === 'linux' && existsSync('/proc/self/stat');
}

/** Reads {alive, startTime} for a pid, or null when it cannot be determined. */
export function probeProcess(pid) {
  if (!livenessProvable()) return null;
  const path = `/proc/${pid}/stat`;
  if (!existsSync(path)) return { alive: false, startTime: null };
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) { return error.code === 'ENOENT' ? { alive: false, startTime: null } : null; }
  // Field 22 (starttime) counted after the comm field, which may contain spaces.
  const fields = raw.slice(raw.lastIndexOf(') ') + 2).split(' ');
  return { alive: true, startTime: fields[19] ?? null, state: fields[0] };
}

function writeDurable(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * Classify an existing lock. Returns one of held / contested / abandoned /
 * awaiting-operator. NEVER returns a state that authorises a break on its own.
 */
export function classifyLock(metadata, { now = Date.now(), probe = probeProcess } = {}) {
  if (metadata === null) {
    // An unreadable or malformed lock is not an absent one.
    return { state: 'contested', reason: 'LOCK_METADATA_UNREADABLE' };
  }
  const info = probe(metadata.pid);
  if (info === null) {
    // Liveness cannot be proven here. Expired or not, a human decides.
    const expired = now - metadata.acquiredAt > metadata.ttlMs;
    return expired
      ? { state: 'awaiting-operator', reason: 'LIVENESS_UNPROVABLE_ON_THIS_PLATFORM' }
      : { state: 'held', reason: 'WITHIN_TTL' };
  }
  if (!info.alive) return { state: 'abandoned', reason: 'HOLDER_PID_ABSENT' };
  // Alive. The startTime must match, otherwise the pid was reused.
  if (metadata.startTime && info.startTime && metadata.startTime !== info.startTime) {
    return { state: 'abandoned', reason: 'PID_REUSED' };
  }
  // Alive and the same process. An expired TTL means it is frozen, hung, or
  // slow -- all of which are ALIVE. This is the decision mutation J removes.
  if (now - metadata.acquiredAt > metadata.ttlMs) {
    return { state: 'contested', reason: 'TTL_EXPIRED_BUT_HOLDER_ALIVE' };
  }
  return { state: 'held', reason: 'WITHIN_TTL' };
}

export function readLock(directory) {
  const path = join(directory, LOCK_NAME);
  if (!existsSync(path)) return { present: false, metadata: null };
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { present: false, metadata: null }; throw error; }
  try {
    const metadata = JSON.parse(text);
    if (typeof metadata.pid !== 'number' || typeof metadata.acquiredAt !== 'number') {
      return { present: true, metadata: null };
    }
    return { present: true, metadata };
  } catch { return { present: true, metadata: null }; }
}

export function createRootLock({ directory, ttlMs = DEFAULT_TTL_MS, now = Date.now, probe = probeProcess }) {
  const lockPath = join(directory, LOCK_NAME);

  function selfStartTime() {
    const info = probe(process.pid);
    return info?.startTime ?? null;
  }

  return {
    inspect() {
      const { present, metadata } = readLock(directory);
      if (!present) return { state: 'free', reason: 'NO_LOCK', metadata: null };
      return { ...classifyLock(metadata, { now: now(), probe }), metadata };
    },

    /** Take the lock, or throw 409 ROOT_LOCKED. Never waits, never queues. */
    acquire() {
      const current = this.inspect();
      if (current.state !== 'free') {
        throw new LockError(409, 'ROOT_LOCKED', { state: current.state, reason: current.reason });
      }
      const temporary = join(directory, `.${LOCK_NAME}.tmp.${process.pid}`);
      const metadata = {
        pid: process.pid, startTime: selfStartTime(), acquiredAt: now(), ttlMs,
        host: 'local', version: 1,
      };
      writeDurable(temporary, JSON.stringify(metadata) + '\n');
      try { linkSync(temporary, lockPath); }
      catch (error) {
        if (error.code === 'EEXIST') throw new LockError(409, 'ROOT_LOCKED', { state: 'held', reason: 'RACE_LOST' });
        throw error;
      }
      finally { try { unlinkSync(temporary); } catch { /* best effort */ } }
      return {
        metadata,
        release: () => { try { unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
      };
    },

    /**
     * Break a lock. Only `abandoned` may be broken mechanically; the break is
     * never silent, and the recovery intent is created with O_EXCL so exactly
     * one process owns it.
     */
    breakAbandoned({ operatorOverride = false } = {}) {
      const current = this.inspect();
      if (current.state === 'free') return { action: 'none' };
      // Forbidden transitions, asserted rather than avoided.
      if (current.state === 'held') {
        throw new LockError(409, 'LOCK_HELD', { reason: current.reason });
      }
      if ((current.state === 'contested' || current.state === 'awaiting-operator') && !operatorOverride) {
        throw new LockError(409, 'LOCK_AWAITING_OPERATOR', { state: current.state, reason: current.reason });
      }
      // abandoned -> freeing: the recovery intent comes FIRST and is exclusive.
      const recoveryPath = join(directory, STALE_RECOVERY_NAME);
      let fd;
      try { fd = openSync(recoveryPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new LockError(409, 'LOCK_BREAK_IN_PROGRESS', { reason: 'ANOTHER_BREAKER_OWNS_IT' });
        throw error;
      }
      try {
        const record = JSON.stringify({
          version: 1, kind: 'LOCK_STALE_RECOVERY', deadHolder: current.metadata,
          reason: current.reason, breakerPid: process.pid, at: new Date(now()).toISOString(),
          operatorOverride,
        }) + '\n';
        writeFileSync(fd, record);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      // freeing -> freed
      try { unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { action: 'freed', reason: current.reason, recoveryPath };
    },
  };
}
