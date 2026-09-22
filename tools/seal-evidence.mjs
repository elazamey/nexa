#!/usr/bin/env node
/**
 * Seal a NEW evidence bundle. Forward-only, exactly once.
 *
 * A bundle records what existed at the moment of sealing, and nothing else.
 * This tool therefore REFUSES to re-seal: if SHA256SUMS already exists, it
 * stops. Re-sealing an old bundle produces digests that verify cleanly and
 * describe nothing — the archive-level form of a check that passes without
 * measuring what it claims (docs/principles.md P5).
 *
 * If files were added to a bundle after it was sealed, they do not belong to
 * it. Make a new bundle, or write a SUPERSEDED.md. Do not widen the old seal.
 *
 * `--strict` refuses to seal while docs/evidence/ has uncommitted changes.
 * That is an operational limit, not a principle: when mutation M5 overwrote
 * h2-atomicity, `git checkout` recovered it ONLY because the bundle was
 * committed. An uncommitted bundle has no recovery path at all — one stray
 * write and it is gone (docs/incidents/2026-09-mutation-destroyed-evidence.md).
 *
 * Usage: node tools/seal-evidence.mjs <bundle-name> [--strict]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const VERSION = '1';

function main() {
  const name = process.argv[2];
  if (!name) { console.error('usage: node tools/seal-evidence.mjs <bundle-name>'); return 2; }
  const dir = join(ROOT, 'docs/evidence', basename(name));
  if (!fs.existsSync(dir)) { console.error(`no such bundle: docs/evidence/${basename(name)}`); return 2; }

  const sumsPath = join(dir, 'SHA256SUMS');
  if (fs.existsSync(sumsPath)) {
    console.error(`REFUSED: ${basename(name)} is already sealed.`);
    console.error('A bundle is sealed once and covers only what existed at that moment.');
    console.error('Re-sealing would produce digests that verify today and describe nothing.');
    console.error('If the bundle is out of date, add a SUPERSEDED.md beside it, or seal a NEW bundle.');
    console.error('See docs/principles.md P5.');
    return 1;
  }

  if (process.argv.includes('--strict')) {
    let dirtyEvidence = '';
    try { dirtyEvidence = execFileSync('git', ['status', '--porcelain', '--', 'docs/evidence'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
    catch { console.error('--strict: cannot query git; refusing rather than assuming a clean archive.'); return 2; }
    const blocking = dirtyEvidence.split('\n').filter(Boolean)
      .filter(line => !line.includes('evidence-check.json'));
    if (blocking.length) {
      console.error('REFUSED (--strict): docs/evidence/ has uncommitted changes:');
      for (const line of blocking) console.error(`  ${line}`);
      console.error('\nCommit the archive first. An uncommitted bundle cannot be recovered if a write goes wrong.');
      return 1;
    }
  }

  // The commit is read now, from the repository, not supplied by hand.
  let commit, dirty;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim();
  } catch { console.error('cannot read git HEAD; refusing to seal without provenance.'); return 2; }

  const names = fs.readdirSync(dir).filter(f => f !== 'SHA256SUMS' && f !== 'SUPERSEDED.md' && f !== 'manifest.json'
    && fs.statSync(join(dir, f)).isFile()).sort();
  if (!names.length) { console.error('bundle is empty; nothing to seal.'); return 2; }

  const lines = names.map(file =>
    `${createHash('sha256').update(fs.readFileSync(join(dir, file))).digest('hex')}  ${file}`);
  fs.writeFileSync(sumsPath, lines.join('\n') + '\n');

  const manifestPath = join(dir, 'manifest.json');
  const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  fs.writeFileSync(manifestPath, JSON.stringify({
    ...existing,
    sealed_at: new Date().toISOString(),
    sealed_at_commit: commit,
    sealed_by: `tools/seal-evidence.mjs@${VERSION}`,
    // Recorded, not hidden: a bundle sealed over a dirty tree is pinned to a
    // commit that does not contain the bytes that were hashed.
    sealed_over_dirty_tree: Boolean(dirty),
  }, null, 2) + '\n');

  console.log(`sealed ${basename(name)}: ${names.length} file(s) at ${commit.slice(0, 7)}`);
  if (dirty) console.log('WARNING: the tree was dirty at seal time; recorded as sealed_over_dirty_tree.');
  console.log('This bundle is now immutable. Later files need a new bundle or a SUPERSEDED.md.');
  return 0;
}

process.exit(main());
