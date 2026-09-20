#!/usr/bin/env node
/**
 * NEXA development-plan phase runner.
 * Usage:  node tools/dev/run-phase.mjs <phase|all>
 *
 * Each phase is an ordered list of steps. Each step is either:
 *   - a string: executed via shell from the repo root
 *   - a function: called, its return value coerced to boolean for ok/fail
 * Any failure aborts the phase. Success is recorded to .phase/<n>.result.json.
 * Zero external dependencies.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PHASE_DIR = join(ROOT, '.phase');
mkdirSync(PHASE_DIR, { recursive: true });

process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); else throw e; });

function run(cmd, opts = {}) {
  const { cwd = ROOT, timeout = 180_000 } = opts;
  process.stdout.write('  \x1b[36m$\x1b[0m ' + cmd + '\n');
  const out = spawnSync(cmd, {
    cwd, shell: true, timeout, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  if (out.error) {
    process.stderr.write('  \x1b[31mERROR: ' + out.error.message + '\x1b[0m\n');
    return false;
  }
  if (out.status !== 0) {
    process.stderr.write('  \x1b[31mFAILED (exit ' + out.status + ')\x1b[0m\n');
    return false;
  }
  process.stdout.write('  \x1b[32mok\x1b[0m\n');
  return true;
}

function read(path) { return readFileSync(join(ROOT, path), 'utf8'); }
function write(path, content) { writeFileSync(join(ROOT, path), content); }
function contains(path, fragment) { try { return read(path).includes(fragment); } catch { return false; } }
function fileExists(path) { return existsSync(join(ROOT, path)); }
function ok(label) { process.stdout.write('  \x1b[32m✓\x1b[0m ' + label + '\n'); return true; }
function fail(label) { process.stderr.write('  \x1b[31m✗\x1b[0m ' + label + '\n'); return false; }
function check(cond, label) { return cond ? ok(label) : fail(label); }

// ─────────────────────────────────────────────────────────────────────
// Generated helper files (created by phase 0 if missing)
// ─────────────────────────────────────────────────────────────────────

function ensureCoverageTool() {
  const p = 'tools/dev/measure-coverage.mjs';
  if (fileExists(p)) return;
  write(p,
`#!/usr/bin/env node
// Coverage via Node's built-in --experimental-test-coverage. Zero deps.
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, '.coverage');
mkdirSync(OUT, { recursive: true });
const args = [
  '--test', '--experimental-test-coverage',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov',  '--test-reporter-destination=' + join(OUT, 'lcov.info'),
  '--test-reporter=text-summary', '--test-reporter-destination=' + join(OUT, 'summary.txt'),
  'tests',
];
const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
`);
}

function ensureSmokeTool() {
  const p = 'tools/dev/smoke.mjs';
  if (fileExists(p)) return;
  write(p,
`#!/usr/bin/env node
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
  process.stdout.write('\\n▶ ' + name + '\\n');
  const r = spawnSync('npm', ['run', name], { cwd: ROOT, shell: true, stdio: 'inherit', timeout: 60_000 });
  if (r.status !== 0) { console.error('✗ ' + name + ' failed'); failed++; }
}
console.log('\\n' + (failed === 0 ? '✓' : '✗') + ' smoke: ' + (ALLOWED.length - failed) + '/' + ALLOWED.length + ' passed');
process.exit(failed === 0 ? 0 : 1);
`);
}

function ensureFuzzTool() {
  const p = 'tools/dev/fuzz-canonical.mjs';
  if (fileExists(p)) return;
  write(p,
`#!/usr/bin/env node
import { canonicalize } from '../../packages/ast/index.js';
const seeds = [
  {}, { a: 1 }, [], [1, 2, 'three'], { nested: { deep: true } },
  'hello', 42, 0, true, false, null,
  { b: 1, a: 2, c: { z: 1, y: 2 } },
  'e\\u0301', 'مرحبا', '🚀',
];
const mutators = [
  (v) => Array.isArray(v) ? [...v, Math.random()] : v,
  (v) => (typeof v === 'object' && v !== null) ? ({ ...v, [Math.random().toString(36)]: Math.random() }) : v,
  () => (Math.random() < 0.5 ? Math.floor(Math.random() * 1e9) : Math.random().toString(36)),
  () => Array.from({ length: Math.floor(Math.random() * 5) }, () => Math.random()),
  () => ({}),
];
let good = 0;
for (let i = 0; i < 2000; i++) {
  let v = seeds[Math.floor(Math.random() * seeds.length)];
  for (let m = 0; m < 3; m++) v = mutators[Math.floor(Math.random() * mutators.length)](v);
  try {
    const c = canonicalize(v);
    const rt = JSON.parse(c);
    const c2 = canonicalize(rt);
    if (c !== c2) { console.error('roundtrip fail', v); process.exit(1); }
    good++;
  } catch (e) {
    if (!e.code || !String(e.code).startsWith('NEXA_E_')) { console.error('unexpected error', e); process.exit(1); }
  }
}
console.log('fuzz: ' + good + ' canonical values round-tripped; invalid inputs rejected cleanly');
`);
}

// ─────────────────────────────────────────────────────────────────────
// PHASES
// ─────────────────────────────────────────────────────────────────────

const PHASES = {

  0: {
    name: 'Bootstrapping (الأتمتة الأساسية)',
    steps: [
      ['editorconfig', () => {
        write('.editorconfig',
`root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
`);
        return true;
      }],
      ['makefile', () => {
        write('Makefile',
`.PHONY: test ci demo demo:omega demo:cellular attacks posture cover quick dashboard help setup

help:
\t@echo "NEXA targets:"
\t@echo "  test        npm test (314 tests)"
\t@echo "  quick       tests + posture (dev loop)"
\t@echo "  ci          full CI suite"
\t@echo "  posture     security posture check"
\t@echo "  attacks     31/31 Ω attacks + 8/8 Google"
\t@echo "  cover       coverage report to .coverage/"
\t@echo "  demo        all demos"
\t@echo "  dashboard   start dashboard dev server"
\t@echo "  setup       install dashboard deps"

test:
\tnode --test

quick:
\tnpm run verify:quick

ci:
\tnpm run verify:ci

posture:
\tnode tools/check-posture.mjs

attacks:
\tnode tools/omega-attacks.mjs
\tnode tools/google-attacks.mjs

cover:
\tnpm run cover

demo:
\tnode tools/demo.mjs
\tnode tools/omega-demo.mjs
\tnode tools/cellular-demo.mjs

dashboard:
\tcd dashboard && npm install && npm run dev

setup:
\tcd dashboard && npm install
`);
        return true;
      }],
      ['package-scripts', () => {
        const pkg = JSON.parse(read('package.json'));
        const add = {
          'verify:ci': 'npm test && npm run posture && npm run audit && npm run demo && npm run demo:omega && npm run demo:cellular && npm run attacks && npm run attacks:google && node tools/permission-probe.mjs --run-proof && npm run vectors && git diff --exit-code -- spec/vectors',
          'verify:quick': 'npm test && npm run posture && npm run audit',
          'cover': 'node tools/dev/measure-coverage.mjs',
          'setup': 'cd dashboard && npm install',
          'phase': 'node tools/dev/run-phase.mjs',
          'smoke': 'node tools/dev/smoke.mjs',
        };
        let changed = false;
        for (const [k, v] of Object.entries(add)) {
          if (pkg.scripts[k] !== v) { pkg.scripts[k] = v; changed = true; }
        }
        if (changed) write('package.json', JSON.stringify(pkg, null, 2) + '\n');
        return changed || true;
      }],
      ['coverage-tool', () => { ensureCoverageTool(); return true; }],
      ['smoke-tool',    () => { ensureSmokeTool();    return true; }],
      ['gitignore', () => {
        const p = '.gitignore';
        let gi = existsSync(join(ROOT, p)) ? read(p) : '';
        for (const line of ['.coverage/', '.phase/', 'dashboard/dist/', '.DS_Store', 'npm-debug.log*']) {
          if (!gi.includes(line)) gi += (gi.endsWith('\n') ? '' : '\n') + line + '\n';
        }
        write(p, gi);
        return true;
      }],
      ['verify-quick', () => run('npm run verify:quick', { timeout: 60_000 })],
    ],
    acceptance: [
      () => check(fileExists('.editorconfig'), '.editorconfig exists'),
      () => check(fileExists('Makefile'), 'Makefile exists'),
      () => check(contains('package.json', '"verify:ci"') && contains('package.json', '"cover"'), 'npm scripts added'),
      () => check(fileExists('tools/dev/measure-coverage.mjs'), 'coverage script exists'),
      () => check(fileExists('tools/dev/smoke.mjs'), 'smoke script exists'),
      () => check(contains('.gitignore', '.coverage/') && contains('.gitignore', '.phase/'), '.gitignore updated'),
    ],
  },

  1: {
    name: 'Security hardening (تقوية الأمان)',
    steps: [
      ['forbid-eval-newFunction', () => {
        const p = 'tools/check-posture.mjs';
        let s = read(p);
        const extras = [
          '/\\beval\\s*\\(/,',
          '/\\bnew\\s+Function\\s*\\(/,',
          '/\\bFunction\\.prototype\\.constructor\\s*\\.constructor\\s*\\(/,',
        ];
        // Insert right after the process.binding line if not already present.
        for (const line of extras) {
          const key = line.replace(/,\s*$/, '');
          if (!s.includes(key)) {
            s = s.replace(/(\/\\bprocess\\.binding\\b\/,)/, '$1\n  ' + line);
          }
        }
        write(p, s);
        return true;
      }],
      ['fuzz-tool', () => { ensureFuzzTool(); return true; }],
      ['posture', () => run('npm run posture')],
      ['fuzz',    () => run('node tools/dev/fuzz-canonical.mjs')],
      ['tests',   () => run('npm test', { timeout: 60_000 })],
      ['attacks', () => run('npm run attacks')],
      ['attacks:google', () => run('npm run attacks:google')],
    ],
    acceptance: [
      () => check(contains('tools/check-posture.mjs', '\\beval\\s*\\('), 'eval forbidden in posture'),
      () => check(contains('tools/check-posture.mjs', 'new\\s+Function\\s*\\('), 'new Function forbidden'),
      () => check(fileExists('tools/dev/fuzz-canonical.mjs'), 'fuzz tool exists'),
    ],
  },

  2: {
    name: 'Coverage ramp-up (زيادة التغطية)',
    steps: [
      ['celia-dsl-index-test', () => {
        write('tests/celia-dsl.test.js',
`import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dsl from '../packages/cells/celia/dsl/src/index.js';

test('celia dsl index exposes DSL_REGISTRY with compile+validate per DSL', () => {
  assert.equal(typeof dsl, 'object');
  assert.ok(dsl !== null);
  assert.ok(dsl.DSL_REGISTRY, 'DSL_REGISTRY must be exported');
  assert.ok(Object.keys(dsl.DSL_REGISTRY).length >= 10, 'at least 10 DSLs registered');
  for (const [name, entry] of Object.entries(dsl.DSL_REGISTRY)) {
    assert.equal(typeof entry.compile, 'function', name + ' must have compile()');
    assert.equal(typeof entry.validate, 'function', name + ' must have validate()');
  }
});

test('celia dsl index re-exports namespace modules', () => {
  for (const name of ['AIR', 'CtxQL', 'FlowDSL', 'CapLang', 'GuardDSL', 'NanoDSL', 'Speculative']) {
    assert.ok(dsl[name] !== undefined, name + ' namespace should be re-exported');
  }
});
`);
        return true;
      }],
      ['coverage-baseline', () => run('node tools/dev/measure-coverage.mjs', { timeout: 60_000 })],
      ['tests', () => run('npm test', { timeout: 60_000 })],
    ],
    acceptance: [
      () => check(fileExists('.coverage/summary.txt'), 'coverage summary generated'),
      () => check(fileExists('tests/celia-dsl.test.js'), 'celia dsl test added'),
    ],
  },

  3: {
    name: 'Docs & DX (التوثيق)',
    steps: [
      ['docs-kickoff', () => {
        const p = 'docs';
        mkdirSync(join(ROOT, p), { recursive: true });
        write('docs/QUICKSTART.md',
`# Quickstart

\`\`\`bash
git clone https://github.com/elazamey/nexa.git && cd nexa
npm test                      # 314/314 (zero install needed)
npm run posture               # security posture: 6 gates CLOSED
npm run demo                  # end-to-end protocol flow
node examples/hello-nexa.mjs  # your first signed envelope
\`\`\`

See \`DEVELOPMENT_PLAN.md\` for the phased roadmap.
`);
        return true;
      }],
      ['readme-link', () => {
        let r = read('README.md');
        if (!r.includes('docs/QUICKSTART.md')) {
          r = r.replace(/(## Quickstart)/, '$1\n\n📘 Full quickstart: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)');
          write('README.md', r);
        }
        return true;
      }],
      ['verify', () => run('npm run verify:quick', { timeout: 60_000 })],
    ],
    acceptance: [
      () => check(fileExists('docs/QUICKSTART.md'), 'docs/QUICKSTART.md created'),
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

const target = process.argv[2];
if (!target || ['--help', '-h', 'help'].includes(target)) {
  console.log('Usage: node tools/dev/run-phase.mjs <phase|all>');
  console.log('Available phases: ' + Object.keys(PHASES).join(', '));
  process.exit(0);
}

const toRun = target === 'all'
  ? Object.keys(PHASES).map(Number).sort((a, b) => a - b)
  : [Number(target)];

let overall = true;
for (const n of toRun) {
  const phase = PHASES[n];
  if (!phase) { console.error('Unknown phase: ' + n); process.exit(2); }
  const bar = '═'.repeat(70);
  process.stdout.write('\n' + bar + '\n  PHASE ' + n + ' \u2014 ' + phase.name + '\n' + bar + '\n');
  const t0 = Date.now();
  let phaseOk = true;
  const results = [];
  for (const [name, fn] of phase.steps) {
    process.stdout.write('\n\u250C\u2500 ' + name + '\n');
    const t1 = Date.now();
    let r;
    try { r = !!fn(); } catch (e) { process.stderr.write('  threw: ' + (e && e.stack || e) + '\n'); r = false; }
    const dur = ((Date.now() - t1) / 1000).toFixed(2);
    process.stdout.write('\u2514\u2500 ' + (r ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m') + '  ' + name + ' (' + dur + 's)\n');
    results.push({ name, ok: r, duration_s: Number(dur) });
    if (!r) { phaseOk = false; break; }
  }
  if (phaseOk && phase.acceptance) {
    process.stdout.write('\n\u2500\u2500 acceptance \u2500\u2500\n');
    for (const a of phase.acceptance) {
      let r;
      try { r = !!a(); } catch (e) { r = false; }
      if (!r) phaseOk = false;
    }
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(2);
  const line = '\u2500'.repeat(70);
  process.stdout.write('\n' + line + '\n  PHASE ' + n + ' ' + (phaseOk ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m') + ' (' + dur + 's)\n' + line + '\n');
  writeFileSync(join(PHASE_DIR, n + '.result.json'),
    JSON.stringify({ phase: n, name: phase.name, status: phaseOk ? 'PASS' : 'FAIL', duration_s: Number(dur), steps: results, finished_at: new Date().toISOString() }, null, 2) + '\n');
  if (!phaseOk) { overall = false; break; }
}
process.exit(overall ? 0 : 1);
