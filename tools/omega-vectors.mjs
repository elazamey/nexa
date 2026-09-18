#!/usr/bin/env node
/**
 * Pinned Ω vectors.
 *
 * Regenerates `spec/vectors/omega.json`, which pins the things that must never drift
 * silently: the IR hash of every example module, the diagnostics a refused module
 * produces, the type lattice's assignability matrix, capability-reference resolution,
 * an Ω evidence record byte for byte, and the Evolution Gate's verdicts.
 *
 * `npm run vectors` rewrites the files; CI then runs `git diff --exit-code -- spec/vectors`
 * so that a change in behaviour has to be committed as a change in the vectors.
 *
 *   node tools/omega-vectors.mjs
 *   node tools/omega-vectors.mjs --check   (compare, do not write)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile, resolveCapref, TYPE_TABLE, assignable } from '../packages/compiler/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger } from '../packages/runtime/index.js';
import { createManifest, evaluateGate, capabilitiesOf, signManifest } from '../packages/evolution/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = [
  'repository-review.nexa',
  'provider-secrets.nexa',
  'gated-write.nexa',
  'refused-secret-egress.nexa',
  'evolution-proposal.nexa',
];

const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

/** @param {string} name @returns {object} */
function module(name) {
  const path = `examples/omega/${name}`;
  const source = readFileSync(join(root, path), 'utf8');
  return { path, source };
}

const modules = MODULES.map((name) => {
  const { path, source } = module(name);
  const compiled = compile(source, { path });
  return {
    path,
    ok: compiled.ok,
    hash: compiled.hash,
    diagnostics: compiled.diagnostics.map((diagnostic) => diagnostic.toJSON()),
  };
});

const types = {
  table: Object.fromEntries(Object.entries(TYPE_TABLE).map(([name, entry]) => [name, { ...entry }])),
  matrix: {},
};
for (const from of ['String', 'SecretString', 'UntrustedData', 'VerifiedData', 'ToolResult', 'MemoryRef', 'Capability', 'VerifiedString']) {
  for (const to of ['String', 'SecretString', 'UntrustedData', 'VerifiedData', 'MemoryRef', 'Capability']) {
    const verdict = assignable(TYPE_TABLE[from], TYPE_TABLE[to]);
    types.matrix[`${from}->${to}`] = verdict.ok ? 'ok' : `no:${verdict.axis}`;
  }
}

const caprefs = [
  { path: 'fs.read', scope: '/src/main.js', pattern: false },
  { path: 'fs.read', scope: '/src/**', pattern: true },
  { path: 'sanitizer.redact', scope: null, pattern: false },
  { path: 'memory.store', scope: 'episodic', pattern: true },
  { path: 'github.repository.read', scope: null, pattern: false },
  { path: 'echo.call', scope: null, pattern: false },
].map((probe) => {
  const env = {
    instruments: new Map([['echo', { name: 'echo', resource: 'tool:echo', actions: ['call'], trust: 'verified', accepts_secret: false }]]),
    servers: new Map([['github', { name: 'github', tools: ['repository.read', 'issues.read'] }]]),
  };
  const capref = { kind: 'CapRef', path: probe.path, loc: { line: 1, column: 1 }, ...(probe.scope === null ? {} : { scope: probe.scope }) };
  try {
    const resolved = resolveCapref(env, capref, { pattern: probe.pattern });
    return { ...probe, resource: resolved.resource, actions: resolved.actions, origin: resolved.origin, trust: resolved.trust };
  } catch (cause) {
    return { ...probe, error: cause.code };
  }
});

const actor = createIdentity({ label: 'omega-vector-actor', seed: '99'.repeat(32) });
const ledger = new OmegaLedger({ actor, clock, module: 'examples/omega/repository-review.nexa' });
ledger.append({ kind: 'MISSION_START', decision: 'INFO', mission: 'review', step: 0, detail: { goal: 'vector', agent: 'reviewer' } });
ledger.append({
  kind: 'TOOL_RESULT',
  decision: 'ALLOW',
  mission: 'review',
  step: 1,
  resource: 'tool:echo',
  action: 'call',
  capability: 'urn:nexa:cap:vector-capability',
  detail: { kernel_decision: 'ALLOW', code: null, value_hash: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
});
ledger.append({ kind: 'VERDICT', decision: 'ALLOW', mission: 'review', step: 2, detail: { contracts: 0, steps: 2 } });

const evolver = createIdentity({ label: 'omega-vector-evolver', seed: '77'.repeat(32) });
const proposalSource = module('evolution-proposal.nexa');
const proposalCompiled = compile(proposalSource.source, { path: proposalSource.path });
const parent = signManifest(createManifest({
  module: 'planner',
  version: 4,
  source: proposalSource.source,
  compiled: proposalCompiled,
  capabilities: capabilitiesOf(proposalCompiled.ir),
  evolver,
  created: T0,
}), evolver);
const candidate = signManifest(createManifest({
  module: 'planner',
  version: 5,
  parent: 4,
  source: proposalSource.source,
  compiled: proposalCompiled,
  capabilities: capabilitiesOf(proposalCompiled.ir),
  expectations: proposalCompiled.ir.proposals[0].expects,
  evolver,
  created: T0,
}), evolver);
const widened = signManifest(createManifest({
  module: 'planner',
  version: 6,
  parent: 4,
  source: proposalSource.source,
  compiled: proposalCompiled,
  capabilities: [...capabilitiesOf(proposalCompiled.ir), 'fs:*!write'],
  expectations: proposalCompiled.ir.proposals[0].expects,
  evolver,
  created: T0,
}), evolver);

const passingChecks = {
  compile: { status: 'PASS' },
  types: { status: 'PASS' },
  capabilities: { status: 'PASS' },
  security: { status: 'PASS' },
  regression: { status: 'PASS' },
  benchmark: { status: 'PASS', detail: { measurements: { success_rate: 97, security_findings: 0 } } },
  policy: { status: 'PASS' },
};
const failedBenchmark = {
  ...passingChecks,
  benchmark: { status: 'PASS', detail: { measurements: { success_rate: 91, security_findings: 0 } } },
};

const gate = {
  candidate: { module: candidate.module, version: candidate.version, parent: candidate.parent, evolver: candidate.evolver, capabilities: candidate.capabilities },
  parent: { module: parent.module, version: parent.version, capabilities: parent.capabilities },
  parent_manifest_hash: createManifest({
    module: 'planner',
    version: 4,
    source: proposalSource.source,
    compiled: proposalCompiled,
    capabilities: capabilitiesOf(proposalCompiled.ir),
    evolver,
    created: T0,
  }).source_hash,
  verdicts: [
    { name: 'all-stages-pass', verdict: evaluateGate({ candidate, parent, checks: passingChecks, evolvers: [evolver.kid], now: T0 }) },
    { name: 'missing-stage', verdict: evaluateGate({ candidate, parent, checks: { ...passingChecks, security: undefined }, evolvers: [evolver.kid], now: T0 }) },
    { name: 'benchmark-unmet', verdict: evaluateGate({ candidate, parent, checks: failedBenchmark, evolvers: [evolver.kid], now: T0 }) },
    { name: 'authority-widened', verdict: evaluateGate({ candidate: widened, parent, checks: passingChecks, evolvers: [evolver.kid], now: T0 }) },
    {
      name: 'kernel-immutable',
      verdict: evaluateGate({ candidate: { ...candidate, module: 'kernel' }, parent, checks: passingChecks, now: T0 }),
    },
    {
      name: 'untrusted-evolver',
      verdict: evaluateGate({ candidate, parent, checks: passingChecks, evolvers: ['nexa:key:ed25519:z000000000000000000000000000000000000000000000'], now: T0 }),
    },
  ].map((entry) => ({
    name: entry.name,
    verdict: entry.verdict.verdict,
    code: entry.verdict.code,
    failed: entry.verdict.failed,
    action: entry.verdict.action,
    stages: entry.verdict.stages.map((stage) => ({ stage: stage.stage, status: stage.status })),
  })),
};

const payload = {
  nexa: 'omega1',
  ir_version: proposalCompiled.version,
  generated_by: 'node tools/omega-vectors.mjs',
  modules,
  types,
  caprefs,
  ledger: ledger.entries(),
  ledger_head: ledger.head,
  gate,
};

const target = join(root, 'spec/vectors/omega.json');
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== text) {
    process.stderr.write('omega vectors are out of date: run `node tools/omega-vectors.mjs`\n');
    process.exit(1);
  }
  process.stdout.write('omega vectors are in sync\n');
} else {
  writeFileSync(target, text);
  process.stdout.write(`wrote spec/vectors/omega.json (${text.length} bytes, ${modules.length} modules, ${gate.verdicts.length} gate verdicts, ${ledger.length} records)\n`);
}
