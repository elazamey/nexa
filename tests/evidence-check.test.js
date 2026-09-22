/**
 * Tests for the evidence checker, and the rule that keeps it honest.
 *
 * The danger this guards against is subtle: a viewer that reads
 * docs/evidence/ and shows "proven" would assert a verdict from the EXISTENCE
 * OF A FILE — the same defect as the proof endpoint removed in
 * docs/incidents/2026-09-fake-proof-endpoint.md, one layer up.
 *
 * So the tool must emit facts (match/mismatch/missing/unlisted) and never a
 * judgement, and the viewer must not add one back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { verifyEvidence } from '../tools/verify-evidence.mjs';

const ROOT = process.cwd();
const sha = text => createHash('sha256').update(text).digest('hex');

function fixture(t, files, sums) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'nexa-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pkg = join(dir, 'pkg');
  fs.mkdirSync(pkg);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(join(pkg, name), content);
  if (sums !== null) fs.writeFileSync(join(pkg, 'SHA256SUMS'), sums);
  return { dir, pkg };
}

test('a matching digest is reported as match, with no verdict attached', t => {
  const f = fixture(t, { 'a.tap': 'ok 1\n' }, `${sha('ok 1\n')}  a.tap\n`);
  const report = verifyEvidence({ evidenceDir: f.dir });
  const file = report.packages[0].files[0];
  assert.equal(file.status, 'match');
  assert.equal('verified' in file, false, 'the tool must not emit a verdict field');
  assert.equal('proven' in file, false);
  assert.equal(report.summary.match, 1);
});

test('an altered file is reported as mismatch, and the run fails', t => {
  const f = fixture(t, { 'a.tap': 'tampered\n' }, `${sha('ok 1\n')}  a.tap\n`);
  const report = verifyEvidence({ evidenceDir: f.dir });
  const file = report.packages[0].files[0];
  assert.equal(file.status, 'mismatch');
  assert.equal(file.recorded, sha('ok 1\n'));
  assert.equal(file.actual, sha('tampered\n'), 'the recomputed digest must be shown, not hidden');
  assert.equal(report.summary.mismatch, 1);
});

test('a listed file that is gone is missing, never silently dropped', t => {
  const f = fixture(t, {}, `${sha('x')}  vanished.tap\n`);
  const report = verifyEvidence({ evidenceDir: f.dir });
  assert.equal(report.packages[0].files[0].status, 'missing');
  assert.equal(report.summary.missing, 1);
});

test('a file covered by no digest is reported as unlisted, not ignored', t => {
  const f = fixture(t, { 'a.tap': 'ok\n', 'sneaked-in.txt': 'anything\n' }, `${sha('ok\n')}  a.tap\n`);
  const report = verifyEvidence({ evidenceDir: f.dir });
  const unlisted = report.packages[0].files.filter(file => file.status === 'unlisted');
  assert.equal(unlisted.length, 1, 'an uncovered file must be surfaced: absence of a digest is not coverage');
  assert.equal(unlisted[0].name, 'sneaked-in.txt');
});

test('a package with no SHA256SUMS is reported as uncheckable, not as passing', t => {
  const f = fixture(t, { 'a.tap': 'ok\n' }, null);
  const report = verifyEvidence({ evidenceDir: f.dir });
  const pkg = report.packages[0];
  assert.equal(pkg.sums, 'absent');
  assert.match(pkg.note, /nothing in this package can be checked/);
  assert.equal(report.summary.packagesWithoutSums, 1);
  // Crucially it does not count as a match.
  assert.equal(report.summary.match, 0);
});

test('a malformed digest line is surfaced rather than skipped', t => {
  const f = fixture(t, { 'a.tap': 'ok\n' }, 'this is not a digest line\n');
  const report = verifyEvidence({ evidenceDir: f.dir });
  assert.equal(report.packages[0].files.some(file => file.status === 'malformed-record'), true);
});

test('the report carries its own limits so they travel with the data', t => {
  const f = fixture(t, { 'a.tap': 'ok\n' }, `${sha('ok\n')}  a.tap\n`);
  const report = verifyEvidence({ evidenceDir: f.dir });
  assert.match(report.limits, /does not prove/i);
  assert.match(report.limits, /unchanged since the digest was recorded/i);
});

test('the tool emits no verdict vocabulary anywhere in its output', t => {
  const f = fixture(t, { 'a.tap': 'ok\n' }, `${sha('ok\n')}  a.tap\n`);
  const serialised = JSON.stringify(verifyEvidence({ evidenceDir: f.dir }));
  // "does not prove" in the limits string is the only permitted use.
  const withoutLimits = serialised.replace(/"limits":"[^"]*"/g, '');
  // Word boundaries matter: "provenance" legitimately contains "proven".
  for (const word of ['verified', 'proven', 'trusted', 'valid', 'PASS']) {
    const asField = new RegExp(`"${word}"\\s*:`, 'i');
    const asValue = new RegExp(`:\\s*"[^"]*\\b${word}\\b`, 'i');
    assert.equal(asField.test(withoutLimits), false,
      `the checker must not emit a "${word}" field: it reports facts, not verdicts`);
    assert.equal(asValue.test(withoutLimits), false,
      `the checker must not emit "${word}" as a value: it reports facts, not verdicts`);
  }
});

// ------------------------------------------- supersession (P5): documented gaps

const VALID_RECORD = files => `# Supersession Record

- **Status:** partially superseded
- **Recorded:** 2026-09-21
- **Original sealed at commit:** unrecorded
- **Files:** ${files}
- **Reason:** the code moved on after this bundle was sealed.
`;

test('a mismatch named by a valid SUPERSEDED.md becomes superseded-explained', t => {
  const f = fixture(t, { 'a.tap': 'changed\n' }, `${sha('original\n')}  a.tap\n`);
  fs.writeFileSync(join(f.pkg, 'SUPERSEDED.md'), VALID_RECORD('a.tap'));
  const report = verifyEvidence({ evidenceDir: f.dir });
  const file = report.packages[0].files[0];
  assert.equal(file.status, 'superseded-explained');
  // It is a documented gap, not a pass: the digests are still reported.
  assert.equal(file.recorded, sha('original\n'));
  assert.equal(file.actual, sha('changed\n'));
  assert.equal(report.summary.match, 0, 'a documented gap must never be counted as a match');
  assert.equal(report.summary['superseded-explained'], 1);
});

test('removing the record reverts the status to mismatch: it is produced from presence only', t => {
  const f = fixture(t, { 'a.tap': 'changed\n' }, `${sha('original\n')}  a.tap\n`);
  fs.writeFileSync(join(f.pkg, 'SUPERSEDED.md'), VALID_RECORD('a.tap'));
  assert.equal(verifyEvidence({ evidenceDir: f.dir }).packages[0].files[0].status, 'superseded-explained');
  fs.rmSync(join(f.pkg, 'SUPERSEDED.md'));
  assert.equal(verifyEvidence({ evidenceDir: f.dir }).packages[0].files[0].status, 'mismatch');
});

test('a malformed SUPERSEDED.md does NOT downgrade a mismatch', t => {
  // An unparseable explanation is not an explanation. This is the field where
  // a lenient parser would quietly launder every mismatch in the repository.
  for (const bad of [
    '# Supersession Record\n\n- **Status:** superseded\n',                       // no reason/files/commit
    VALID_RECORD('a.tap').replace('- **Reason:** the code moved on after this bundle was sealed.\n', ''),
    VALID_RECORD('a.tap').replace('2026-09-21', 'last Tuesday'),                  // unparseable date
    VALID_RECORD('a.tap').replace('unrecorded', 'probably 9a742fe'),              // a guess, not a sha
  ]) {
    const f = fixture(t, { 'a.tap': 'changed\n' }, `${sha('original\n')}  a.tap\n`);
    fs.writeFileSync(join(f.pkg, 'SUPERSEDED.md'), bad);
    const report = verifyEvidence({ evidenceDir: f.dir });
    assert.equal(report.packages[0].files[0].status, 'mismatch',
      `a malformed record must not launder a mismatch:\n${bad}`);
    assert.equal(report.packages[0].supersession.valid, false);
  }
});

test('a record only downgrades the files it actually names', t => {
  const f = fixture(t, { 'a.tap': 'changed\n', 'b.tap': 'also changed\n' },
    `${sha('one\n')}  a.tap\n${sha('two\n')}  b.tap\n`);
  fs.writeFileSync(join(f.pkg, 'SUPERSEDED.md'), VALID_RECORD('a.tap'));
  const report = verifyEvidence({ evidenceDir: f.dir });
  const byName = Object.fromEntries(report.packages[0].files.map(file => [file.name, file.status]));
  assert.equal(byName['a.tap'], 'superseded-explained');
  assert.equal(byName['b.tap'], 'mismatch', 'an unnamed file must keep its mismatch');
});

test('SUPERSEDED.md is not itself reported as unlisted', t => {
  const f = fixture(t, { 'a.tap': 'ok\n' }, `${sha('ok\n')}  a.tap\n`);
  fs.writeFileSync(join(f.pkg, 'SUPERSEDED.md'), VALID_RECORD('a.tap'));
  const report = verifyEvidence({ evidenceDir: f.dir });
  assert.equal(report.packages[0].files.some(file => file.name === 'SUPERSEDED.md'), false,
    'the record comments on the bundle; it is deliberately outside SHA256SUMS');
});

test('an unsealed bundle marked UNVERIFIABLE.md is acknowledged, never checkable', t => {
  const f = fixture(t, { 'a.tap': 'ok\n' }, null);
  fs.writeFileSync(join(f.pkg, 'UNVERIFIABLE.md'), '# Unverifiable — permanent\n');
  const report = verifyEvidence({ evidenceDir: f.dir });
  assert.equal(report.packages[0].acknowledged, true);
  assert.equal(report.packages[0].sums, 'absent');
  assert.equal(report.summary.match, 0, 'acknowledging a gap must not create a match');
  assert.equal(report.summary.packagesWithoutSums, 1);
});

test('the real h2-atomicity gap is documented, not regenerated', () => {
  // Guards the actual decision: this bundle must keep its recorded mismatch.
  const record = join(ROOT, 'docs/evidence/h2-atomicity/SUPERSEDED.md');
  assert.equal(fs.existsSync(record), true, 'h2-atomicity must keep its supersession record');
  const sums = fs.readFileSync(join(ROOT, 'docs/evidence/h2-atomicity/SHA256SUMS'), 'utf8');
  assert.equal(sums.includes('SUPERSEDED.md'), false, 'the record must not be sealed into the bundle');
  const pkg = verifyEvidence().packages.find(p => p.package === 'h2-atomicity');
  assert.equal(pkg.files.some(f => f.status === 'superseded-explained'), true);
  assert.equal(pkg.supersession.valid, true);
});

test('seal-evidence refuses to re-seal an existing bundle', t => {
  // Run against a DISPOSABLE COPY, never the real archive.
  //
  // The first version of this test invoked the sealer on the live
  // docs/evidence/h2-atomicity. That was safe only while the refusal worked —
  // and the whole point of a mutation run is to break the refusal. Mutation M5
  // disabled it and the test itself re-sealed the real bundle, destroying the
  // pinned digest this package exists to preserve. A test that becomes
  // destructive exactly when the guard it tests is broken is a trap.
  const sandbox = fs.mkdtempSync(join(tmpdir(), 'nexa-seal-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const bundle = join(sandbox, 'docs/evidence/already-sealed');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(join(bundle, 'a.tap'), 'ok\n');
  fs.writeFileSync(join(bundle, 'SHA256SUMS'), `${sha('ok\n')}  a.tap\n`);
  const before = fs.readFileSync(join(bundle, 'SHA256SUMS'), 'utf8');

  const sealer = join(ROOT, 'tools/seal-evidence.mjs');
  const result = spawnSync(process.execPath, [sealer, 'already-sealed'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(result.status, 1, 're-sealing must fail');
  assert.match(result.stderr, /already sealed/);
  assert.equal(fs.readFileSync(join(bundle, 'SHA256SUMS'), 'utf8'), before,
    'the existing seal must be byte-identical after a refused re-seal');
});

test('seal-evidence seals a new bundle with provenance read from the repository', t => {
  const sandbox = fs.mkdtempSync(join(tmpdir(), 'nexa-seal-new-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: sandbox });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: sandbox });
  const bundle = join(sandbox, 'docs/evidence/fresh');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(join(bundle, 'run.tap'), 'ok 1\n');

  const result = spawnSync(process.execPath, [join(ROOT, 'tools/seal-evidence.mjs'), 'fresh'], { cwd: sandbox, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(join(bundle, 'SHA256SUMS'), 'utf8'), `${sha('ok 1\n')}  run.tap\n`);
  const manifest = JSON.parse(fs.readFileSync(join(bundle, 'manifest.json'), 'utf8'));
  assert.match(manifest.sealed_at_commit, /^[0-9a-f]{40}$/, 'the commit must be read from git, not supplied');
  assert.match(manifest.sealed_by, /seal-evidence\.mjs@/);
  assert.equal(typeof manifest.sealed_over_dirty_tree, 'boolean');
});

// ------------------------------------------------------- the viewer's rule

test('the evidence viewer renders the tool output and adds no verdict of its own', () => {
  const viewer = join(ROOT, 'dashboard/src/components/EvidenceCheckPanel.jsx');
  if (!fs.existsSync(viewer)) return; // viewer is optional; the tool is not
  const source = fs.readFileSync(viewer, 'utf8');
  // Word boundaries: "provenance" legitimately contains "proven".
  for (const banned of ['verified', 'proven', 'trusted', 'authentic']) {
    assert.equal(new RegExp(`\\b${banned}\\b`, 'i').test(source), false,
      `the viewer must not render "${banned}": it displays facts, it does not judge`);
  }
  for (const glyph of ['✅', '✔', '✓', '❌']) {
    assert.equal(source.includes(glyph), false,
      `the viewer must not render "${glyph}": a tick is a verdict rendered as an icon`);
  }
  // It must not recompute or re-derive status client-side either.
  assert.equal(/createHash|sha256\(/.test(source), false,
    'the viewer must not compute digests: the tool verifies, the viewer displays');
});

test('the checked-in evidence report is current with the tool', () => {
  const path = join(ROOT, 'docs/evidence/evidence-check.json');
  if (!fs.existsSync(path)) return;
  const stored = JSON.parse(fs.readFileSync(path, 'utf8'));
  const fresh = verifyEvidence();
  const strip = report => report.packages.map(pkg => ({
    package: pkg.package,
    files: pkg.files.map(file => `${file.name}:${file.status}`).sort(),
  }));
  assert.deepEqual(strip(stored), strip(fresh),
    'docs/evidence/evidence-check.json is stale: run `npm run evidence`');
});
