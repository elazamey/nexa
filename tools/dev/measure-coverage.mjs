#!/usr/bin/env node
// Coverage via Node's built-in --experimental-test-coverage. Zero deps.
import { mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, '.coverage');
mkdirSync(OUT, { recursive: true });

const testsDir = join(ROOT, 'tests');
const tests = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(testsDir, f));

const args = [
  '--test', '--experimental-test-coverage',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov',  '--test-reporter-destination=' + join(OUT, 'lcov.info'),
  ...tests,
];
console.log('Running ' + tests.length + ' test files with coverage → ' + OUT);
const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('\nCoverage report written to ' + OUT + '/');
