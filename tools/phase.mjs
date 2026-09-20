#!/usr/bin/env node
/** Run the numbered NEXA delivery gates.
 *
 * Usage: npm run phase -- 4 | 5 | 6 | 7 | 8 | all
 * The runner deliberately uses argv arrays (not a shell) so phase commands are
 * deterministic and safe on Windows as well as Unix.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const phases = new Map([
  ['4', { name: 'Dashboard & UI', steps: [
    ['dashboard dependencies', [ 'install', '--prefix', 'dashboard', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund' ], true],
    ['dashboard production build', [ 'run', 'build', '--prefix', 'dashboard' ]],
  ]}],
  ['5', { name: 'Benchmarks', steps: [
    ['Ω benchmark and learning demonstration', [ 'run', 'demo:omega' ]],
    ['cellular benchmark and learning demonstration', [ 'run', 'demo:cellular' ]],
  ]}],
  ['6', { name: 'MCP/GitHub/HTTP organs', steps: [
    ['MCP and endpoint tests', [ 'test', '--', 'tests/mcp.test.js', 'tests/endpoint.test.js' ]],
    ['Google organ security tests', [ 'test', '--', 'tests/google-attacks.test.js', 'tests/google-binding.test.js', 'tests/google-capability.test.js', 'tests/google-gateway.test.js', 'tests/google-identity.test.js', 'tests/google-invariants.test.js' ]],
  ]}],
  ['7', { name: 'Release automation', steps: [
    ['preview baseline', [ 'run', 'preview:baseline' ]],
    ['permission proof probe', [ 'run', 'proof:permission:auto' ]],
    ['release ceremony scripts', [ 'run', 'posture' ]],
  ]}],
  ['8', { name: 'v1.0 GA', steps: [
    ['full verification', [ 'run', 'verify' ]],
    ['metrics and documentation', [ 'run', 'metrics' ]],
  ]}],
]);

function usage() {
  console.log('Usage: npm run phase -- <4|5|6|7|8|all>');
  for (const [id, phase] of phases) console.log(`  ${id}  ${phase.name}`);
}

const requested = process.argv[2];
if (!requested || requested === '--help' || requested === '-h') { usage(); process.exit(requested ? 0 : 1); }
const ids = requested === 'all' ? [...phases.keys()] : [requested];
if (ids.some(id => !phases.has(id))) { console.error(`Unknown phase: ${requested}`); usage(); process.exit(2); }

function run(label, args, optional = false) {
  // Phase 4 can reuse an existing install. Installation is best-effort only;
  // the build remains the required assertion.
  if (optional && existsSync(join(root, 'dashboard', 'node_modules'))) {
    console.log(`  ✓ ${label} (already installed)`);
    return true;
  }
  console.log(`  ▶ ${label}`);
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) return false;
  return true;
}

for (const id of ids) {
  const phase = phases.get(id);
  console.log(`\nPhase ${id}: ${phase.name}`);
  for (const [label, args, optional] of phase.steps) {
    if (!run(label, args, optional)) {
      console.error(`\n✗ Phase ${id} failed at: ${label}`);
      process.exit(1);
    }
  }
  console.log(`✓ Phase ${id} complete`);
}
console.log('\nAll requested phases passed.');
