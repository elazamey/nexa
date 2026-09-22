/**
 * Dashboard stats contract.
 *
 * OmegaPanel and SingularityPanel read the API response through several levels
 * of optional chaining, which turns every shape mismatch into a blank render
 * rather than a failure. That is exactly how the envelope bug survived into the
 * repository: the API nests its payload under `stats`, the panels read the
 * root, and the UI showed `NaNs` plus empty sections while looking connected.
 *
 * These tests assert the two things optional chaining hides:
 *   1. the unwrap helper returns the nested payload, and
 *   2. the exact paths the panels render actually exist in a real response.
 *
 * The server is started as a child process so this runs inside `npm run verify`
 * with no browser and no new dependency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { unwrapStats } from '../dashboard/src/lib/fetchStats.js';

const ROOT = process.cwd();

// ---------------------------------------------------------------- pure helper

test('unwrapStats returns the nested payload, not the envelope', () => {
  const envelope = { ok: true, version: 'v1.1', stats: { version: 'inner', uptime: 42, omega: { a: 1 } } };
  const stats = unwrapStats(envelope);
  assert.equal(stats.uptime, 42, 'uptime must come from the nested object');
  assert.deepEqual(stats.omega, { a: 1 });
  assert.equal(stats.version, 'inner', 'the inner version wins; the outer one masked the bug');
});

test('unwrapStats tolerates an already-unwrapped body', () => {
  const body = { version: 'v1', uptime: 1, omega: {} };
  assert.equal(unwrapStats(body), body);
});

test('unwrapStats does not invent an object out of a failure body', () => {
  assert.equal(unwrapStats(null), null);
  assert.equal(unwrapStats('nope'), 'nope');
});

// ------------------------------------------------------- live contract checks

/** Start the dashboard API on an ephemeral port and wait for it to listen. */
async function startServer(t) {
  const port = 34000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [join(ROOT, 'tools/celia-dashboard-server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 20_000);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('Dashboard Server running')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited early: ${code}`)); });
  });
  return { port, get: async path => unwrapStats(await (await fetch(`http://127.0.0.1:${port}${path}`)).json()) };
}

/** Read a dotted path, reporting the first missing segment rather than undefined. */
function resolvePath(object, path) {
  let cursor = object;
  const walked = [];
  for (const key of path.split('.')) {
    if (cursor === null || cursor === undefined) {
      return { ok: false, missingAt: walked.join('.') || '<root>' };
    }
    cursor = cursor[key];
    walked.push(key);
  }
  return { ok: cursor !== undefined, value: cursor, missingAt: path };
}

test('OmegaPanel: every field it renders exists in the real response', async t => {
  const server = await startServer(t);
  const stats = await server.get('/api/v1/omega/stats');

  // The four summary cards. `uptime` is the one that rendered NaNs.
  for (const path of ['version', 'uptime', 'executionLog']) {
    const found = resolvePath(stats, path);
    assert.ok(found.ok, `OmegaPanel reads stats.${path}, missing at ${found.missingAt}`);
  }
  assert.equal(typeof stats.uptime, 'number', 'uptime must be numeric or the panel renders NaNs');

  // The guard for the whole 10-engine section.
  assert.ok(stats.omega, 'stats.omega guards the entire engine grid; undefined hides it silently');

  // A representative field from each engine card actually rendered.
  for (const path of [
    'omega.formalZ3', 'omega.lyapunov', 'omega.hyperbolic', 'omega.quantumEntanglement',
    'omega.consciousness', 'omega.godel', 'omega.omegaPoint', 'omega.akashic',
    'omega.negentropy', 'omega.metamorphic',
  ]) {
    const found = resolvePath(stats, path);
    assert.ok(found.ok, `OmegaPanel renders stats.${path}, missing at ${found.missingAt}`);
  }

  // The nested singularity foundation block the panel also reads.
  assert.ok(resolvePath(stats, 'singularity.singularity.fpga').ok,
    'OmegaPanel reads stats.singularity.singularity.fpga');
});

test('SingularityPanel: every field it renders exists in the real response', async t => {
  const server = await startServer(t);
  const stats = await server.get('/api/v1/singularity/stats');

  for (const path of ['version', 'uptime', 'executionLog']) {
    assert.ok(resolvePath(stats, path).ok, `SingularityPanel reads stats.${path}`);
  }
  assert.equal(typeof stats.uptime, 'number', 'uptime must be numeric or the panel renders NaNs');
  assert.ok(stats.singularity, 'stats.singularity guards the engine grid');

  for (const path of [
    'singularity.fpga', 'singularity.analog', 'infinite.infinite.zkProof',
    'infinite.infinite.jit', 'infinite.infinite.hdc', 'infinite.advanced.kvDedup',
  ]) {
    const found = resolvePath(stats, path);
    assert.ok(found.ok, `SingularityPanel renders stats.${path}, missing at ${found.missingAt}`);
  }
});

// --------------------------------------------------- the swallowed-error rule

test('no panel swallows a fetch failure', () => {
  const directory = join(ROOT, 'dashboard/src/components');
  const offenders = [];
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.jsx'))) {
    const source = fs.readFileSync(join(directory, file), 'utf8');
    // `.catch(() => {})` makes a dead API indistinguishable from a live one.
    if (/catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `these panels discard fetch errors: ${offenders.join(', ')}`);
});

test('reviewed panels surface loading and error states', () => {
  for (const file of ['OmegaPanel.jsx', 'SingularityPanel.jsx']) {
    const source = fs.readFileSync(join(ROOT, 'dashboard/src/components', file), 'utf8');
    assert.match(source, /statsError/, `${file} must hold a stats error in state`);
    assert.match(source, /loading/, `${file} must distinguish loading from empty`);
    assert.match(source, /fetchStats/, `${file} must use the checked fetch helper`);
  }
});

/**
 * Mutation U2 (dropping the `res.ok` check) makes a 500 resolve as success with
 * the error body as "stats". No assertion above caught that, so it is asserted
 * directly here: the helper must classify by status, not by parseability.
 */
test('fetchStats reports an HTTP failure instead of treating the error body as stats', async () => {
  const { fetchStats } = await import('../dashboard/src/lib/fetchStats.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 500, statusText: 'Internal Server Error',
    json: async () => ({ error: 'boom' }),
  });
  try {
    const result = await fetchStats('/api/v1/omega/stats');
    assert.equal(result.ok, false, 'a 500 must never be reported as success');
    assert.match(result.error, /500/);
  } finally { globalThis.fetch = originalFetch; }
});

test('fetchStats reports a network failure rather than throwing or hiding it', async () => {
  const { fetchStats } = await import('../dashboard/src/lib/fetchStats.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const result = await fetchStats('/api/v1/omega/stats');
    assert.equal(result.ok, false);
    assert.match(result.error, /ECONNREFUSED/);
  } finally { globalThis.fetch = originalFetch; }
});
