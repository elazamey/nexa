#!/usr/bin/env node
/**
 * Ambient-authority proof.
 *
 * Run under Node's permission model, which denies network, child processes, worker
 * threads and filesystem writes unless a flag allows them:
 *
 *   npm run proof:permission
 *
 * The script does two things, and both must hold:
 *
 *   1. exercises the full protocol surface — identity, capability, ALLOW, gate DENY,
 *      evidence chain, MCP bridge — and fails if any of it breaks;
 *   2. *attempts* a filesystem write, a child process and a network call, and fails
 *      if the runtime does **not** deny them. Without step 2 the proof would be
 *      vacuous: "it ran under a sandbox" means nothing if the sandbox was open.
 *
 * Node's own test runner needs child processes per file, so the suite cannot be run
 * this way; this script is the runtime-enforced complement to `npm run posture`,
 * which reads the sources instead of executing them.
 */
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { Policy, gatePosture } from '../packages/policy/index.js';
import { Endpoint } from '../packages/protocol/index.js';
import { verifyEvidenceChain, verifyReceipt } from '../packages/evidence/index.js';
import { McpBridge } from '../adapters/mcp/index.js';

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

if (process.permission === undefined) {
  process.stderr.write(
    'permission model is not active — run `npm run proof:permission` ' +
    '(or on older Node: `node --experimental-permission --allow-fs-read=. tools/permission-proof.mjs`)\n',
  );
  process.exit(2);
}

const failures = [];
const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

// --- 1. the protocol must work with no ambient authority --------------------
const operator = createIdentity({ label: 'operator', seed: '11'.repeat(32) });
const agent = createIdentity({ label: 'agent-01', kind: 'agent', seed: '22'.repeat(32) });

const endpoint = new Endpoint({
  identity: agent,
  clock,
  capabilityIssuers: [operator.kid],
  policy: new Policy({
    rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] }],
  }),
});
endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
endpoint.trust.pin(operator.document);

const caller = new Endpoint({ identity: operator, clock });
caller.trust.pin(agent.document);

const capability = mintCapability({
  issuer: operator,
  subject: operator.kid,
  resource: 'tool:echo',
  actions: ['call'],
  caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 5, max_depth: 0 },
});

const allowed = endpoint.receive(
  caller.call({ to: agent.kid, resource: 'tool:echo', args: { text: 'hello' }, capability }),
);
const denied = endpoint.receive(
  caller.call({ to: agent.kid, resource: 'fs:/etc/passwd', action: 'write', args: {}, capability }),
);
const chain = verifyEvidenceChain(endpoint.evidence.entries());
const bridge = new McpBridge({ endpoint });
const posture = bridge.handleRpc({ jsonrpc: '2.0', id: 1, method: 'nexa/posture' }).result;

if (allowed.decision !== 'ALLOW') failures.push(`expected ALLOW, got ${allowed.decision}/${allowed.code}`);
if (JSON.stringify(allowed.value) !== '{"echoed":{"text":"hello"}}') failures.push('handler value mismatch');
if (verifyReceipt(allowed.receipt).ok !== true) failures.push('ALLOW receipt did not verify');
if (denied.code !== 'NEXA_E_GATE') failures.push(`expected NEXA_E_GATE, got ${denied.code}`);
if (denied.reply.body.details.gate !== 'FILESYSTEM_WRITE') failures.push('wrong gate reported');
if (chain.ok !== true) failures.push('evidence chain did not verify');
if (posture.gates.some((gate) => gate.state !== 'CLOSED')) failures.push('MCP posture reported an open gate');
if (gatePosture().some((gate) => gate.state !== 'CLOSED')) failures.push('gate posture is not all CLOSED');

// --- 2. the runtime must actually deny ambient authority --------------------
const attempts = {};

try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/nexa-permission-proof-should-not-exist', 'x');
  attempts.filesystemWrite = 'ALLOWED';
} catch (error) {
  attempts.filesystemWrite = error.code ?? error.message;
}

try {
  const { execSync } = await import('node:child_process');
  execSync('echo should-not-run');
  attempts.childProcess = 'ALLOWED';
} catch (error) {
  attempts.childProcess = error.code ?? error.message;
}

try {
  await fetch('https://example.com');
  attempts.network = 'ALLOWED';
} catch (error) {
  attempts.network = error.code ?? error.message;
}

for (const [name, result] of Object.entries(attempts)) {
  if (result === 'ALLOWED') failures.push(`${name} was not denied — the proof is vacuous`);
}

if (failures.length > 0) {
  process.stderr.write('permission proof FAILED\n');
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write([
  'permission proof OK',
  `  protocol flow: ALLOW ${JSON.stringify(allowed.value)}, gate DENY ${denied.code}/${denied.reply.body.details.gate}`,
  `  evidence: ${chain.length} records, chain verified, ${endpoint.evidence.summary().length} kinds`,
  `  gates: ${gatePosture().map((gate) => gate.name).join(', ')} all CLOSED`,
  `  runtime denied: filesystem write (${attempts.filesystemWrite}), child process (${attempts.childProcess}), network (${attempts.network})`,
  '',
].join('\n'));
