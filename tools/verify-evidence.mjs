#!/usr/bin/env node
/**
 * Evidence verification — recompute digests and report facts.
 *
 * This tool exists because the obvious alternative is a defect. A dashboard
 * that reads docs/evidence/ and shows a "proven" badge would be asserting a
 * verdict from the EXISTENCE OF A FILE, which is the same failure as the
 * proof endpoint deleted in docs/incidents/2026-09-fake-proof-endpoint.md.
 * A file can be stale, hand-edited after signing, copied in by hand, or belong
 * to a commit unrelated to HEAD.
 *
 * So this tool emits facts, never judgements:
 *   - `match`                 the recorded digest equals the recomputed digest
 *   - `mismatch`              the file exists and its bytes differ from the record
 *   - `missing`               SHA256SUMS lists a file that is not on disk
 *   - `unlisted`              a file exists in the package but no digest covers it
 *   - `superseded-explained`  a mismatch with a valid SUPERSEDED.md naming it
 *
 * `superseded-explained` is NOT a pass. It is a mismatch whose cause has been
 * written down and attributed. It is produced only from the PRESENCE of a
 * valid record, never from its absence: delete the record and the status
 * reverts to `mismatch`. Old bundles are never re-sealed to make a mismatch go
 * away — regenerated digests verify cleanly and describe nothing
 * (docs/principles.md P5).
 *
 * The word "verified" does not appear in the output, and there is no score,
 * no aggregate grade and no badge. Digest agreement proves a file has not
 * changed since its digest was taken. It does not prove the file describes
 * reality, that the run happened, or that the claims inside it are true. That
 * limit is carried in the output itself so it travels with the data.
 *
 * Usage:  node tools/verify-evidence.mjs [--json]
 * Exit:   0 all listed digests match, 1 any mismatch/missing, 2 tool error.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const EVIDENCE_DIR = join(ROOT, 'docs/evidence');

const LIMITS = [
  'A digest match proves the bytes are unchanged since the digest was recorded.',
  'It does not prove the run happened, that the file describes the current code,',
  'or that any claim inside the file is true.',
  'Commit provenance is checked only when the package records a commit.',
].join(' ');

const sha256 = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');

/** `<digest>  <name>` per line, as produced by sha256sum. */
function parseSums(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (!match) { entries.push({ malformed: line.trim() }); continue; }
    entries.push({ digest: match[1], name: match[2] });
  }
  return entries;
}

/** Does this commit exist in history, and is it an ancestor of HEAD? */
function commitProvenance(commit) {
  if (!commit) return { recorded: false };
  const short = String(commit).trim();
  if (!/^[0-9a-f]{7,40}$/.test(short)) return { recorded: true, commit: short, state: 'unparseable' };
  try {
    execFileSync('git', ['cat-file', '-e', `${short}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    return { recorded: true, commit: short, state: 'unknown-to-this-repository' };
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', short, 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
    return { recorded: true, commit: short, state: 'ancestor-of-head' };
  } catch {
    return { recorded: true, commit: short, state: 'not-an-ancestor-of-head' };
  }
}

/**
 * Parse SUPERSEDED.md. Required fields: Status, Recorded, Reason, Files, and
 * `Original sealed at commit` (which may be the literal `unrecorded` when the
 * bundle genuinely did not record one — guessing a commit is forbidden).
 *
 * A malformed record does NOT downgrade a mismatch. An unparseable explanation
 * is not an explanation.
 */
function readSupersession(directory) {
  const path = join(directory, 'SUPERSEDED.md');
  if (!fs.existsSync(path)) return null;
  const text = fs.readFileSync(path, 'utf8');
  const field = label => {
    const match = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+(?:\\n(?!\\s*-\\s\\*\\*)[^\\n]+)*)`, 'i').exec(text);
    return match ? match[1].trim().replace(/\s+/g, ' ') : null;
  };
  const record = {
    status: field('Status'),
    recorded: field('Recorded'),
    sealedAtCommit: field('Original sealed at commit'),
    reason: field('Reason'),
    files: field('Files'),
    supersededBy: field('Superseded by'),
  };
  const missingFields = ['status', 'recorded', 'sealedAtCommit', 'reason', 'files']
    .filter(key => !record[key]);
  if (missingFields.length) return { valid: false, missingFields, path: 'SUPERSEDED.md' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.recorded)) {
    return { valid: false, missingFields: ['Recorded must be YYYY-MM-DD'], path: 'SUPERSEDED.md' };
  }
  if (!/^(unrecorded|[0-9a-f]{7,40})$/i.test(record.sealedAtCommit)) {
    return { valid: false, missingFields: ['Original sealed at commit must be a sha or `unrecorded`'], path: 'SUPERSEDED.md' };
  }
  // Only the files this record actually names may be downgraded.
  const named = new Set(record.files.split(/[,\s]+/).filter(Boolean));
  return { valid: true, ...record, covers: named };
}

function readManifest(directory) {
  const path = join(directory, 'manifest.json');
  if (!fs.existsSync(path)) return { present: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    // Manifests were written by hand across packages and use different keys.
    // Report which key was found rather than silently normalising.
    const commitKey = ['commit', 'commit_parent', 'commitParent', 'head'].find(k => parsed[k]);
    const generatedKey = ['generated', 'createdAt', 'generatedAt'].find(k => parsed[k]);
    return {
      present: true,
      commitKey: commitKey ?? null,
      commit: commitKey ? parsed[commitKey] : null,
      generated: generatedKey ? parsed[generatedKey] : null,
    };
  } catch (error) {
    return { present: true, unreadable: error.message };
  }
}

export function verifyEvidence({ evidenceDir = EVIDENCE_DIR } = {}) {
  const packages = [];
  if (!fs.existsSync(evidenceDir)) {
    return { schema: 'nexa-evidence-check/v1', limits: LIMITS, packages, summary: emptySummary() };
  }

  for (const entry of fs.readdirSync(evidenceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = join(evidenceDir, entry.name);
    const sumsPath = join(directory, 'SHA256SUMS');
    const manifest = readManifest(directory);

    if (!fs.existsSync(sumsPath)) {
      // An UNVERIFIABLE.md marks this as a permanent, acknowledged state
      // rather than an outstanding task. It does not make the bundle checkable.
      const marked = fs.existsSync(join(directory, 'UNVERIFIABLE.md'));
      packages.push({
        package: entry.name,
        sums: 'absent',
        note: marked
          ? 'no SHA256SUMS: permanently unverifiable, acknowledged in UNVERIFIABLE.md'
          : 'no SHA256SUMS: nothing in this package can be checked',
        acknowledged: marked,
        manifest, files: [],
      });
      continue;
    }

    const listed = parseSums(fs.readFileSync(sumsPath, 'utf8'));
    const supersession = readSupersession(directory);
    const files = [];
    const covered = new Set();
    for (const record of listed) {
      if (record.malformed) {
        files.push({ name: record.malformed, status: 'malformed-record' });
        continue;
      }
      // Packages differ: some record bare names, some record repo-relative
      // paths. Resolve both, and record which form was used rather than
      // silently accepting either.
      const bare = record.name.includes('/') ? record.name.split('/').pop() : record.name;
      const asRecorded = join(ROOT, record.name);
      const inPackage = join(directory, record.name);
      const filePath = fs.existsSync(inPackage) ? inPackage
        : fs.existsSync(asRecorded) ? asRecorded
        : join(directory, bare);
      covered.add(bare);
      covered.add(record.name);
      if (!fs.existsSync(filePath)) {
        files.push({ name: record.name, status: 'missing', recorded: record.digest });
        continue;
      }
      const actual = sha256(filePath);
      let status = actual === record.digest ? 'match' : 'mismatch';
      // A mismatch is downgraded only when a VALID record names this file.
      const explained = status === 'mismatch' && supersession?.valid
        && (supersession.covers.has(record.name) || supersession.covers.has(bare));
      if (explained) status = 'superseded-explained';
      files.push({
        name: record.name,
        status,
        recorded: record.digest,
        ...(status === 'match' ? {} : { actual }),
        ...(explained ? { supersededRecorded: supersession.recorded, sealedAtCommit: supersession.sealedAtCommit } : {}),
        bytes: fs.statSync(filePath).size,
      });
    }
    // Files present but covered by no digest are reported, not ignored.
    for (const name of fs.readdirSync(directory)) {
      // SUPERSEDED.md is a comment ON the bundle, not a member of it, so it is
      // deliberately outside SHA256SUMS and is not reported as unlisted.
      if (name === 'SHA256SUMS' || name === 'SUPERSEDED.md' || covered.has(name)) continue;
      files.push({ name, status: 'unlisted', bytes: fs.statSync(join(directory, name)).size });
    }

    packages.push({
      package: entry.name,
      sums: 'present',
      manifest,
      provenance: commitProvenance(manifest.commit),
      ...(supersession ? { supersession: supersession.valid
        ? { valid: true, recorded: supersession.recorded, sealedAtCommit: supersession.sealedAtCommit, supersededBy: supersession.supersededBy ?? null }
        : { valid: false, missingFields: supersession.missingFields, note: 'record is malformed; mismatches are NOT downgraded' } } : {}),
      files,
    });
  }

  return { schema: 'nexa-evidence-check/v1', checkedAt: new Date().toISOString(), limits: LIMITS, packages, summary: summarise(packages) };
}

const emptySummary = () => ({ packages: 0, match: 0, mismatch: 0, 'superseded-explained': 0, missing: 0, unlisted: 0, malformed: 0, packagesWithoutSums: 0 });

function summarise(packages) {
  // `explained_gaps` is kept strictly apart from `match`, and
  // `total_unresolved` counts only what nobody has accounted for. A reader must
  // not be able to mistake "0 mismatch" for "no gaps": the mismatch in
  // h2-atomicity did not go away when it was explained, it was attributed.
  // Delete its SUPERSEDED.md and it returns to `mismatch` immediately.
  const summary = emptySummary();
  summary.packages = packages.length;
  for (const pkg of packages) {
    if (pkg.sums !== 'present') summary.packagesWithoutSums++;
    for (const file of pkg.files) {
      if (file.status === 'match') summary.match++;
      else if (file.status === 'mismatch') summary.mismatch++;
      else if (file.status === 'superseded-explained') summary['superseded-explained']++;
      else if (file.status === 'missing') summary.missing++;
      else if (file.status === 'unlisted') summary.unlisted++;
      else if (file.status === 'malformed-record') summary.malformed++;
    }
  }
  summary.explained_gaps = summary['superseded-explained'];
  summary.total_unresolved = summary.mismatch + summary.missing;
  summary.note = summary.explained_gaps
    ? `${summary.explained_gaps} explained gap(s) are counted separately from match and are not resolved`
    : 'no explained gaps';
  return summary;
}

function main() {
  let report;
  try { report = verifyEvidence(); }
  catch (error) { console.error(`evidence check failed: ${error.message}`); return 2; }

  const output = join(ROOT, 'docs/evidence/evidence-check.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    for (const pkg of report.packages) {
      const counts = pkg.files.reduce((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});
      const provenance = pkg.provenance?.recorded ? `commit ${pkg.provenance.commit} ${pkg.provenance.state}` : 'no commit recorded';
      console.log(`${pkg.package.padEnd(36)} ${pkg.sums === 'present' ? JSON.stringify(counts) : 'NO SHA256SUMS'}  ${provenance}`);
    }
    const s = report.summary;
    console.log(`\n${s.packages} packages: ${s.match} match, ${s.mismatch} mismatch, ${s['superseded-explained']} superseded-explained, ${s.missing} missing, ${s.unlisted} unlisted, ${s.malformed} malformed, ${s.packagesWithoutSums} without SHA256SUMS`);
    if (s['superseded-explained']) console.log('superseded-explained is a documented gap, not a pass.');
    console.log(`\n${report.limits}`);
    console.log(`\nwrote ${relative(ROOT, output)}`);
  }
  return (report.summary.mismatch > 0 || report.summary.missing > 0) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
