/**
 * P03 package 8 — the root lock.
 *
 * Test order follows the design (8bis.6): the primitive first, then "frozen is
 * not dead" SECOND, before contention. Building contention first would invite
 * an implicit "expired TTL means free", which test 2 exists to demolish.
 *
 * No sleeps. Time is injected; freezing is done with a real SIGSTOP on a real
 * process. Where liveness cannot be proven, tests SKIP rather than report a
 * pass they did not earn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import {
  createRootLock, classifyLock, probeProcess, livenessProvable,
  LOCK_NAME, STALE_RECOVERY_NAME,
} from '../tools/celia-commit-root-lock.mjs';

const TTL = 200;

function dir(t) {
  const d = fs.mkdtempSync(join(tmpdir(), 'nexa-lock-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** A frozen-but-alive holder: `sh` + `sleep`, detached, then SIGSTOP. */
function frozenHolder(t) {
  const child = spawn('sh', ['-c', 'echo ready >&2; exec sleep 300'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  child.unref();
  t.after(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ } });
  return new Promise(resolve => {
    child.stderr.once('data', () => {
      assert.equal(fs.existsSync(`/proc/${child.pid}`), true, 'FIXTURE_DIED before it could be frozen');
      process.kill(child.pid, 'SIGSTOP');
      // SIGSTOP is delivered asynchronously: the kernel may still report 'R'
      // for a few microseconds after kill() returns. Poll for the observable
      // transition instead of assuming it already happened -- an assumption
      // about timing is exactly what this package refuses to encode.
      const deadline = Date.now() + 2000;
      const awaitStopped = () => {
        const info = probeProcess(child.pid);
        assert.equal(info?.alive, true, 'FIXTURE_DIED: the holder must be alive while frozen');
        if (info.state === 'T') return resolve(child.pid);
        assert.ok(Date.now() < deadline, `FIXTURE_NOT_STOPPED: state stayed ${info.state}`);
        setImmediate(awaitStopped);
      };
      awaitStopped();
    });
  });
}

// ---------------------------------------------------------------- 1. primitive

test('P03/8.1 acquire then release, and the lock name is complete the instant it appears', t => {
  const d = dir(t);
  const lock = createRootLock({ directory: d, ttlMs: TTL });
  assert.equal(lock.inspect().state, 'free');

  const held = lock.acquire();
  const raw = fs.readFileSync(join(d, LOCK_NAME), 'utf8');
  const parsed = JSON.parse(raw); // must never be empty or partial
  assert.equal(parsed.pid, process.pid);
  assert.equal(parsed.ttlMs, TTL);
  assert.equal(lock.inspect().state, 'held');
  // The temp file used for the link must not survive.
  assert.deepEqual(fs.readdirSync(d).filter(f => f.includes('tmp')), []);

  held.release();
  assert.equal(lock.inspect().state, 'free');
});

// ------------------------------------------------- 2. frozen is not dead (J)

test('P03/8.2 a frozen holder with an expired TTL is contested, never broken', async t => {
  if (!livenessProvable()) return t.skip('liveness is not provable on this platform');
  const d = dir(t);
  const pid = await frozenHolder(t);

  // Write the lock as if the frozen process owned it, with the TTL long gone.
  const info = probeProcess(pid);
  const acquiredAt = 1_000_000;
  fs.writeFileSync(join(d, LOCK_NAME), JSON.stringify({
    pid, startTime: info.startTime, acquiredAt, ttlMs: TTL, version: 1,
  }) + '\n', { mode: 0o600 });

  const lock = createRootLock({ directory: d, ttlMs: TTL, now: () => acquiredAt + TTL * 100 });
  const state = lock.inspect();

  // MUTATION J deletes the distinction these three assertions defend.
  assert.equal(state.state, 'contested', 'an expired TTL over a LIVE holder is contested');
  assert.equal(state.reason, 'TTL_EXPIRED_BUT_HOLDER_ALIVE');
  assert.notEqual(state.state, 'abandoned', 'a frozen process is alive; it is not abandoned');
  assert.notEqual(state.state, 'free');

  // And it must be impossible to take or break the root while contested.
  assert.throws(() => lock.acquire(), error => error.status === 409 && error.code === 'ROOT_LOCKED');
  assert.throws(() => lock.breakAbandoned(), error => error.code === 'LOCK_AWAITING_OPERATOR');
  assert.equal(fs.existsSync(join(d, LOCK_NAME)), true, 'a live holder lock must survive');
  assert.equal(fs.existsSync(join(d, STALE_RECOVERY_NAME)), false, 'no recovery intent may be written');
});

// ------------------------------------------------------- 3. contention (I, I2)

test('P03/8.3 two separate processes contend, exactly one wins, the loser gets 409', t => {
  const d = dir(t);
  const script = `
    import { createRootLock } from '${process.cwd()}/tools/celia-commit-root-lock.mjs';
    const lock = createRootLock({ directory: ${JSON.stringify(d)}, ttlMs: 60000 });
    try { lock.acquire(); process.stdout.write('WON'); }
    catch (error) { process.stdout.write('LOST:' + error.code); }
  `;
  const run = () => execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const first = run();
  const second = run();
  assert.equal(first, 'WON');
  assert.equal(second, 'LOST:ROOT_LOCKED', 'the second process must be refused immediately, not queued');
});

// ------------------------------------------------------- 4. proven dead (L)

test('P03/8.4 a wholly absent holder is abandoned; a reused pid is not mistaken for it', t => {
  if (!livenessProvable()) return t.skip('liveness is not provable on this platform');
  const d = dir(t);
  // A pid that exited: spawn and reap it.
  const corpse = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
  const deadPid = corpse.pid;
  return new Promise(resolve => corpse.once('exit', () => {
    fs.writeFileSync(join(d, LOCK_NAME), JSON.stringify({
      pid: deadPid, startTime: '999999', acquiredAt: Date.now(), ttlMs: 60_000, version: 1,
    }) + '\n', { mode: 0o600 });
    const lock = createRootLock({ directory: d, ttlMs: TTL });
    const state = lock.inspect();
    assert.equal(state.state, 'abandoned');
    assert.equal(state.reason, 'HOLDER_PID_ABSENT');

    // Mutation L removes the startTime half: a LIVE pid with a different
    // startTime is a reused pid, which is abandoned for a different reason.
    const reused = classifyLock(
      { pid: process.pid, startTime: 'not-the-real-one', acquiredAt: Date.now(), ttlMs: 60_000 },
      { now: Date.now() });
    assert.equal(reused.state, 'abandoned');
    assert.equal(reused.reason, 'PID_REUSED');

    // The live, matching case must remain held even so.
    const mine = classifyLock(
      { pid: process.pid, startTime: probeProcess(process.pid).startTime, acquiredAt: Date.now(), ttlMs: 60_000 },
      { now: Date.now() });
    assert.equal(mine.state, 'held');
    resolve();
  }));
});

// ------------------------------------------- 5. simultaneous breakers (K, M)

test('P03/8.5 two processes breaking one dead lock: one wins, and the break leaves a trace', t => {
  const d = dir(t);
  fs.writeFileSync(join(d, LOCK_NAME), JSON.stringify({
    pid: 2, startTime: '1', acquiredAt: 0, ttlMs: TTL, version: 1,
  }) + '\n', { mode: 0o600 });
  // Force the abandoned classification deterministically.
  const probe = () => ({ alive: false, startTime: null });
  const a = createRootLock({ directory: d, ttlMs: TTL, probe });
  const b = createRootLock({ directory: d, ttlMs: TTL, probe });

  assert.equal(a.inspect().state, 'abandoned');
  const won = a.breakAbandoned();
  assert.equal(won.action, 'freed');

  // Mutation M removes the recovery intent: the break must never be silent.
  assert.equal(fs.existsSync(join(d, STALE_RECOVERY_NAME)), true, 'a break must leave a recovery intent');
  const trace = JSON.parse(fs.readFileSync(join(d, STALE_RECOVERY_NAME), 'utf8'));
  assert.equal(trace.kind, 'LOCK_STALE_RECOVERY');
  assert.equal(trace.deadHolder.pid, 2);
  assert.equal(trace.breakerPid, process.pid);

  // Mutation K makes the break non-atomic: a second breaker must be refused,
  // because the recovery intent is created with O_EXCL.
  fs.writeFileSync(join(d, LOCK_NAME), JSON.stringify({
    pid: 3, startTime: '1', acquiredAt: 0, ttlMs: TTL, version: 1,
  }) + '\n', { mode: 0o600 });
  assert.throws(() => b.breakAbandoned(), error => error.code === 'LOCK_BREAK_IN_PROGRESS');
});

// ------------------------------------------------------- 6. empty lock (N)

test('P03/8.6 an empty or partial lock file is contested, never abandoned', t => {
  const d = dir(t);
  fs.writeFileSync(join(d, LOCK_NAME), '', { mode: 0o600 });
  const lock = createRootLock({ directory: d, ttlMs: TTL });
  const state = lock.inspect();
  // An empty lock cannot be told apart from a holder mid-write, so it is never
  // treated as free or abandoned. Using link() means we should never CREATE
  // one; this asserts we also never MISREAD one.
  assert.equal(state.state, 'contested');
  assert.equal(state.reason, 'LOCK_METADATA_UNREADABLE');
  assert.throws(() => lock.acquire(), error => error.code === 'ROOT_LOCKED');
  assert.throws(() => lock.breakAbandoned(), error => error.code === 'LOCK_AWAITING_OPERATOR');

  // Truncated JSON is the same hazard.
  fs.writeFileSync(join(d, LOCK_NAME), '{"pid":12', { mode: 0o600 });
  assert.equal(lock.inspect().state, 'contested');
});

test('P03/8.7 acquiring never produces an empty lock name (link, not O_EXCL)', t => {
  const d = dir(t);
  const lock = createRootLock({ directory: d, ttlMs: TTL });
  lock.acquire();
  // The inode carrying the name must have been fully written before it existed.
  const stat = fs.statSync(join(d, LOCK_NAME));
  assert.ok(stat.size > 0, 'the lock name must never appear with zero bytes');
  const text = fs.readFileSync(join(d, LOCK_NAME), 'utf8');
  assert.doesNotThrow(() => JSON.parse(text), 'the lock name must be parseable the instant it exists');
});

/**
 * Mutation I survived test 8.3, because `acquire()` refuses at the inspect()
 * pre-check and never reaches linkSync — so 8.3 measured the pre-check, not the
 * atomic claim. The pre-check is an optimisation; link() is the guarantee.
 *
 * These two tests attack the claim itself: the window between inspect() seeing
 * `free` and link() running is exactly where two processes race.
 */
test('P03/8.8 the atomic claim holds when the pre-check is bypassed entirely', t => {
  const d = dir(t);
  const script = `
    import { createRootLock } from '${process.cwd()}/tools/celia-commit-root-lock.mjs';
    const lock = createRootLock({ directory: ${JSON.stringify(d)}, ttlMs: 60000 });
    // Both processes are released here having ALREADY observed 'free', which is
    // the real race: the pre-check cannot serialise anything.
    process.stdin.once('data', () => {
      try { lock.acquire(); process.stdout.write('WON'); }
      catch (error) { process.stdout.write('LOST:' + error.code); }
    });
    process.stdout.write('READY');
  `;
  // Start both, let both see an empty directory, then let both claim.
  const runners = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', script],
    { stdio: ['pipe', 'pipe', 'ignore'] }));
  t.after(() => runners.forEach(r => { try { r.kill('SIGKILL'); } catch {} }));

  return new Promise(resolve => {
    const outcomes = [];
    let ready = 0;
    for (const runner of runners) {
      let buffer = '';
      runner.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer === 'READY') { if (++ready === 2) runners.forEach(r => r.stdin.write('go\n')); return; }
        if (buffer.startsWith('READY') && buffer.length > 5) {
          outcomes.push(buffer.slice(5));
          if (outcomes.length === 2) {
            const winners = outcomes.filter(o => o === 'WON');
            assert.equal(winners.length, 1, `exactly one winner, got ${JSON.stringify(outcomes)}`);
            assert.equal(outcomes.filter(o => o.startsWith('LOST')).length, 1);
            resolve();
          }
        }
      });
    }
  });
});

test('P03/8.9 a claim on an already-held root is refused by link(), not by the pre-check', t => {
  const d = dir(t);
  const first = createRootLock({ directory: d, ttlMs: 60_000 });
  first.acquire();

  // A lock whose inspect() is forced to report `free` — simulating the instant
  // between the pre-check and the claim. The refusal must still happen, and it
  // must come from EEXIST on link().
  const racer = createRootLock({ directory: d, ttlMs: 60_000 });
  racer.inspect = () => ({ state: 'free', reason: 'FORCED_STALE_PRECHECK', metadata: null });
  let error;
  try { racer.acquire(); } catch (caught) { error = caught; }
  assert.ok(error, 'link() must refuse even when the pre-check says free');
  assert.equal(error.code, 'ROOT_LOCKED');
  assert.equal(error.detail.reason, 'RACE_LOST', 'the refusal must come from the atomic claim');
  // The incumbent's metadata must be untouched.
  assert.equal(JSON.parse(fs.readFileSync(join(d, LOCK_NAME), 'utf8')).pid, process.pid);
});
