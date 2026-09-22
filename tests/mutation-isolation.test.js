/**
 * P6 — mutation runs operate on copies, never on live data.
 *
 * Why this file exists: mutation M5 disabled the re-seal refusal in
 * seal-evidence.mjs while the corresponding test pointed the sealer at the
 * REAL docs/evidence/h2-atomicity. The sealer did as told and overwrote the
 * archive, deleting the pinned digest that bundle exists to preserve. The
 * suite stayed green, because a re-sealed bundle is internally consistent.
 * (docs/incidents/2026-09-mutation-destroyed-evidence.md)
 *
 * The lesson is not "fix that one test". A mutation run exists to break
 * guards, so any test whose safety depends on the guard it is testing becomes
 * destructive at exactly the moment it matters. M1–M4 never tripped this only
 * because they happened not to target the refusal — they were equally capable.
 *
 * So the isolation boundary is asserted structurally, across every test, and
 * it must hold for tests that do not exist yet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const TESTS = join(ROOT, 'tests');

const testFiles = fs.readdirSync(TESTS).filter(f => f.endsWith('.test.js'));

/** Tools that create, modify or delete files when executed. */
const WRITE_CAPABLE = /(seal-evidence|celia-system|celia-dashboard-server|celia-workspace-commit-port|verify-evidence)\.mjs/;

test('no test spawns a write-capable tool with the repository as its working directory', () => {
  const offences = [];
  for (const file of testFiles) {
    const source = fs.readFileSync(join(TESTS, file), 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (!WRITE_CAPABLE.test(line)) return;
      // Look at the spawn call around this reference for its cwd.
      const window = lines.slice(index, index + 4).join(' ');
      if (!/spawnSync|spawn\(|execFileSync|execSync|fork\(/.test(window)) return;
      const cwd = /cwd:\s*([A-Za-z_$][\w$.]*)/.exec(window);
      // No cwd at all means it inherits the runner's cwd: the repository.
      if (!cwd) { offences.push(`${file}:${index + 1} — no explicit cwd (inherits the repository)`); return; }
      if (/^(ROOT|root|repoRoot|process)$/.test(cwd[1]) && cwd[1] !== 'root') {
        offences.push(`${file}:${index + 1} — cwd: ${cwd[1]} points at the live repository`);
      }
    });
  }
  assert.deepEqual(offences, [],
    'a write-capable tool must be run against a throwaway directory:\n' + offences.join('\n'));
});

test('no test writes into docs/evidence/', () => {
  // The archive is the one thing in this repository that cannot be rebuilt:
  // re-deriving it is exactly the forbidden act (P5).
  const offences = [];
  for (const file of testFiles) {
    const source = fs.readFileSync(join(TESTS, file), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (!/docs\/evidence/.test(line)) return;
      if (!/writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|mkdirSync|cpSync/.test(line)) return;
      // Copying OUT of the archive is how a test works on a copy — that is the
      // rule being enforced, not a breach of it. What matters is the
      // destination: docs/evidence must not be the target of a write.
      const call = /(?:writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|mkdirSync|cpSync)\s*\(([^;]*)/.exec(line);
      const args = call ? call[1] : line;
      // Split on the top-level comma: for cpSync(src, dest) only the first
      // argument may mention the archive. Everything else — including a single
      // -argument rmSync/writeFileSync — is treated as a write to it.
      const firstArgEnd = (() => {
        let depth = 0;
        for (let i = 0; i < args.length; i++) {
          if ('([{'.includes(args[i])) depth++;
          else if (')]}'.includes(args[i])) depth--;
          else if (args[i] === ',' && depth === 0) return i;
        }
        return args.length;
      })();
      const source = args.slice(0, firstArgEnd);
      const destination = args.slice(firstArgEnd);
      const isCopy = /cpSync|renameSync/.test(line);
      if (isCopy && /docs\/evidence/.test(source) && !/docs\/evidence/.test(destination)) return;
      offences.push(`${file}:${index + 1} — ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offences, [], 'tests must read docs/evidence/, never write it:\n' + offences.join('\n'));
});

test('the evidence archive is unmodified after the suite has run', () => {
  // The backstop. The two checks above read source and can be outwitted by a
  // path built at runtime; this one asks git what actually changed on disk.
  // It is the check that would have caught M5 immediately.
  let status;
  try {
    status = execFileSync('git', ['status', '--porcelain', '--', 'docs/evidence'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return; // not a git checkout; nothing to compare against
  }
  // evidence-check.json is the checker's own output and is expected to move.
  const dirty = status.split('\n').filter(Boolean)
    .filter(line => !line.includes('evidence-check.json'));
  assert.deepEqual(dirty, [],
    'the evidence archive changed while the tests ran — a sealed bundle must never be rewritten:\n' + dirty.join('\n'));
});

test('seal-evidence refuses to touch a bundle whose directory has uncommitted changes', () => {
  // The operational limit: git checkout only rescued h2-atomicity because it
  // was committed. An unsealed-but-uncommitted bundle has no recovery path.
  const source = fs.readFileSync(join(ROOT, 'tools/seal-evidence.mjs'), 'utf8');
  assert.match(source, /--strict/, 'the sealer must expose a strict mode');
  assert.match(source, /status', '--porcelain/, 'strict mode must consult git for uncommitted changes');
});
