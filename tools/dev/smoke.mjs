#!/usr/bin/env node
// Runs each smoke-listed script and reports failures. Zero deps.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ALLOWED = ['test', 'posture', 'audit', 'demo', 'demo:omega', 'attacks', 'metrics', 'proof:permission:probe'];
let failed = 0;
for (const name of ALLOWED) {
  if (!pkg.scripts[name]) { console.log('skip (no script): ' + name); continue; }
  process.stdout.write('\n▶ ' + name + '\n');
  const r = spawnSync('npm', ['run', name], { cwd: ROOT, shell: true, stdio: 'inherit', timeout: 60_000 });
  if (r.status !== 0) { console.error('✗ ' + name + ' failed'); failed++; }
}
console.log('\n' + (failed === 0 ? '✓' : '✗') + ' smoke: ' + (ALLOWED.length - failed) + '/' + ALLOWED.length + ' passed');
process.exit(failed === 0 ? 0 : 1);
