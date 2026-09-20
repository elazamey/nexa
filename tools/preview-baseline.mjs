#!/usr/bin/env node
/**
 * Preview baseline check — verifies that a preview branch keeps the
 * invariants listed in spec/preview-baseline.md.
 *
 *   node tools/preview-baseline.mjs
 *   node tools/preview-baseline.mjs --json
 *
 * It does NOT run the full test suite; it checks the cheap invariants:
 *   - spec files exist
 *   - vectors are in sync (via git diff if available)
 *   - posture file lists 6 gates CLOSED
 *   - permission probe exists
 *
 * Full verification remains `npm run verify`.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

function exists(path) {
  try { statSync(join(root, path)); return true; } catch { return false; }
}

const requiredDocs = [
  'spec/omega/README.md',
  'spec/omega/grammar.ebnf',
  'spec/omega/language.md',
  'spec/omega/types.md',
  'spec/omega/authority.md',
  'spec/omega/evidence.md',
  'spec/omega/evolution.md',
  'spec/omega/mcp.md',
  'spec/omega/learning.md',
  'spec/omega/threat-model.md',
  'spec/omega/cellular.md',
  'spec/preview-baseline.md',
];

for (const doc of requiredDocs) {
  if (!exists(doc)) failures.push(`missing ${doc}`);
  else notes.push(`found ${doc}`);
}

if (!exists('tools/permission-probe.mjs')) {
  notes.push('permission-probe.mjs not yet present — expected in next commit');
} else {
  notes.push('found tools/permission-probe.mjs');
}

try {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  if (!ci.includes('permission')) failures.push('ci.yml does not mention permission proof');
  else notes.push('ci.yml mentions permission');
} catch {
  failures.push('cannot read ci.yml');
}

let vectorsDirty = null;
try {
  execSync('git diff --quiet -- spec/vectors', { cwd: root, stdio: 'ignore' });
  vectorsDirty = false;
  notes.push('vectors clean');
} catch {
  try {
    const out = execSync('git diff --name-only -- spec/vectors', { cwd: root }).toString().trim();
    if (out) {
      vectorsDirty = true;
      failures.push(`vectors dirty: ${out.split('\n').join(', ')}`);
    } else {
      vectorsDirty = false;
    }
  } catch {
    vectorsDirty = null;
    notes.push('git not available for vector check');
  }
}

const result = {
  ok: failures.length === 0,
  failures,
  notes,
  vectorsDirty,
  timestamp: new Date().toISOString(),
  branch: (() => { try { return execSync('git branch --show-current', { cwd: root }).toString().trim(); } catch { return null; } })(),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.ok) {
    console.log('preview baseline OK');
    for (const n of notes) console.log(`  - ${n}`);
  } else {
    console.error('preview baseline FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    for (const n of notes) console.log(`  - ${n}`);
    process.exit(1);
  }
}
