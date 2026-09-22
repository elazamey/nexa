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
