#!/usr/bin/env node
/**
 * CI gate: every hard gate must be CLOSED, and nothing behind one may be exposed.
 *
 * This is deliberately a Node program rather than shell one-liners: an earlier CI
 * step piped `npm run report:json` into a file, and npm's banner turned the file
 * into invalid JSON. A step that fails for its own reasons is worse than no step,
 * because it hides the real signal.
 *
 *   node tools/check-posture.mjs
 */
import { buildReport } from './gate-report.mjs';
import { GATED_ACTIONS, GATED_RESOURCES } from '../packages/policy/index.js';
import { MESSAGE_TYPES } from '../packages/ast/index.js';
import { EVIDENCE_KINDS } from '../packages/evidence/index.js';
import { OMEGA_EVIDENCE_KINDS, HEAL_PHASES } from '../packages/runtime/index.js';
import { ATTACK_CATEGORIES, GATE_STAGES, KERNEL_MODULES } from '../packages/evolution/index.js';
import { OMEGA_ERROR_CODES } from '../packages/compiler/index.js';
import { CELL_STATES, MEMBRANE_STEPS, LIFE_SUPPORT, SERVING_STATES } from '../packages/cell/index.js';

// Piping into `head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const report = buildReport();
const failures = [];

// 1. every gate closed
for (const gate of report.posture.gates) {
  if (gate.state !== 'CLOSED') failures.push(`gate ${gate.name} is ${gate.state}`);
}
if (report.posture.gates.length !== 6) {
  failures.push(`expected 6 gates, found ${report.posture.gates.length}`);
}

// 2. the gate tables are non-empty and cover the documented namespaces
if (Object.keys(GATED_RESOURCES).length < 10) failures.push('gated resource table looks incomplete');
if (Object.keys(GATED_ACTIONS).length < 10) failures.push('gated action table looks incomplete');

// 3. the protocol surface is the documented one
if (MESSAGE_TYPES.length !== 8) failures.push('envelope type list changed unexpectedly');
if (EVIDENCE_KINDS.length !== 10) failures.push('evidence kind list changed unexpectedly');

// 4. nothing in the protocol packages or adapters may import an execution or
//    filesystem API. The gate tables are allowed to *name* `spawn`/`exec`/`write`
//    — that is how they refuse them — so the check looks for real usage:
//    module imports and the synchronous `*Sync`/stream APIs, not bare words.
const FORBIDDEN = [
  /from\s+['"]node:child_process['"]/,
  /from\s+['"]child_process['"]/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]node:fs\/promises['"]/,
  /\b(spawnSync|execSync|execFileSync|exec)\s*\(/,
  /\b(writeFileSync|appendFileSync|unlinkSync|rmSync|mkdirSync|createWriteStream|createWriteStreamSync)\s*\(/,
  /\bprocess\.binding\b/,
];

const checks = [
  ['packages/policy/src/gates.js', /GATE_NAMES/, true],
  ['packages/policy/src/gates.js', /CLOSED/, true],
];

const { readFileSync, readdirSync, statSync } = await import('node:fs');
const { dirname, join, relative } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} directory @returns {string[]} every .js/.mjs file below it */
function walkSources(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...walkSources(path));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

for (const [file, pattern, shouldMatch] of checks) {
  const source = readFileSync(join(root, file), 'utf8');
  const matched = pattern.test(source);
  if (!shouldMatch && matched) {
    failures.push(`${file} matches ${pattern} — a gate may have been opened`);
  }
  if (shouldMatch && !matched) {
    failures.push(`${file} no longer matches ${pattern}`);
  }
}

// Scan every protocol and adapter source file for forbidden API usage.
for (const area of ['packages', 'adapters']) {
  for (const file of walkSources(join(root, area))) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(source)) {
        failures.push(`${relative(root, file)} matches ${pattern} — ambient authority detected`);
      }
    }
  }
}

// 5. Ω invariants. These are the claims the Ω documents make; a check that only
//    documents them would be worth nothing, so they are asserted here.
const OMEGA_FORBIDDEN = [
  // No ambient secrets: the vault is injected, and nothing reads the environment.
  /\bprocess\.env\b/,
];
for (const file of walkSources(join(root, 'packages'))) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of OMEGA_FORBIDDEN) {
    if (pattern.test(source)) failures.push(`${relative(root, file)} matches ${pattern} — ambient authority detected`);
  }
}
if (!KERNEL_MODULES.includes('kernel') || !KERNEL_MODULES.includes('verifier')
  || !KERNEL_MODULES.includes('policy-engine') || !KERNEL_MODULES.includes('capability-authority')) {
  failures.push('the kernel immutability list no longer names kernel, verifier, policy-engine and capability-authority');
}
if (GATE_STAGES.length !== 8) failures.push(`the Evolution Gate has ${GATE_STAGES.length} stages; the spec names 8`);
if (ATTACK_CATEGORIES.length !== 11) failures.push(`the adversarial suite has ${ATTACK_CATEGORIES.length} categories; the spec names 11`);
if (HEAL_PHASES.length !== 6) failures.push(`the healer has ${HEAL_PHASES.length} phases; the spec names 6`);
if (OMEGA_EVIDENCE_KINDS.length < 20) failures.push('the Ω record kinds look incomplete');

// 6. The compiler is pure: no clock, no randomness. A hash that depends on the time is
//    not a commitment.
for (const file of walkSources(join(root, 'packages/compiler'))) {
  const source = readFileSync(file, 'utf8');
  if (/\bnew Date\s*\(|\bDate\.now\s*\(|\bMath\.random\s*\(/.test(source)) {
    failures.push(`${relative(root, file)} reads a clock or randomness — the compiler must be deterministic`);
  }
}

// 7. Only the authority mints. The runtime cannot create permission, and this is the
//    line that says so.
for (const file of walkSources(join(root, 'packages/runtime'))) {
  const source = readFileSync(file, 'utf8');
  if (/\bmintCapability\s*\(/.test(source) && !file.endsWith('src/authority.js')) {
    failures.push(`${relative(root, file)} mints a capability — only the authority may`);
  }
}
// 8. Layering: the language layer never imports the runtime, and the runtime never
//    imports the CLI or the evolution registry.
for (const file of walkSources(join(root, 'packages/compiler'))) {
  const source = readFileSync(file, 'utf8');
  if (/from\s+['"][^'"]*\/(runtime|evolution|cli)\//.test(source)) {
    failures.push(`${relative(root, file)} imports a higher layer — the compiler must stay below the runtime`);
  }
}

// 8b. The cellular layer: the membrane order is the design's order, and a cell cannot
//     mint. These two are the claims the cellular documents make, so they are asserted.
const REQUIRED_STEPS = ['identity', 'capability', 'type', 'policy', 'budget', 'execution', 'evidence'];
if (MEMBRANE_STEPS.join(' → ') !== REQUIRED_STEPS.join(' → ')) {
  failures.push(`the membrane crosses ${MEMBRANE_STEPS.join(' → ')}; the spec names ${REQUIRED_STEPS.join(' → ')}`);
}
if (CELL_STATES.length !== 6) failures.push(`the cell lifecycle has ${CELL_STATES.length} states; the spec names 6`);
if (SERVING_STATES.includes('DEGRADED') === false) failures.push('a degraded cell must still serve; only isolation stops traffic');
if (!LIFE_SUPPORT.includes('health') || !LIFE_SUPPORT.includes('recover')) failures.push('life-support receptors are missing from the membrane');
for (const file of walkSources(join(root, 'packages/cell'))) {
  const source = readFileSync(file, 'utf8');
  const where = relative(root, file);
  if (/\bnew Authority\s*\(/.test(source) && !where.endsWith('src/guarantor.js')) {
    failures.push(`${where} holds an authority — only the guarantor may, and it is never handed to a cell`);
  }
  if (/\b\.issue\s*\(/.test(source) && !where.endsWith('src/guarantor.js') && !where.endsWith('src/tissue.js') && !where.endsWith('src/organism.js')) {
    failures.push(`${where} mints a capability outside the guarantor`);
  }
  if (/\bmintCapability\s*\(/.test(source)) failures.push(`${where} mints a capability directly — that is the authority's job`);
}

// 9. The Ω specification ships with the code it describes.
for (const doc of [
  'spec/omega/README.md', 'spec/omega/grammar.ebnf', 'spec/omega/language.md', 'spec/omega/types.md',
  'spec/omega/authority.md', 'spec/omega/evidence.md', 'spec/omega/evolution.md', 'spec/omega/mcp.md',
  'spec/omega/learning.md', 'spec/omega/threat-model.md',
  'spec/omega/cellular.md', 'spec/omega/cellular.ar.md', 'spec/omega/README.ar.md',
  'spec/vectors/omega.json', 'spec/vectors/cellular.json',
]) {
  try {
    statSync(join(root, doc));
  } catch {
    failures.push(`${doc} is missing — the spec and the implementation travel together`);
  }
}

if (failures.length > 0) {
  process.stderr.write('posture check FAILED\n');
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`posture check OK: ${report.posture.gates.length} gates CLOSED, ` +
  `${Object.keys(GATED_RESOURCES).length} gated namespaces, ${Object.keys(GATED_ACTIONS).length} gated actions, ` +
  `${GATE_STAGES.length} Ω gate stages, ${ATTACK_CATEGORIES.length} attack categories, ` +
  `${KERNEL_MODULES.length} immutable kernel modules, ` +
  `${Object.keys(OMEGA_ERROR_CODES).length} Ω error codes, ` +
  `${MEMBRANE_STEPS.length} membrane steps, ${CELL_STATES.length} cell states\n`);
