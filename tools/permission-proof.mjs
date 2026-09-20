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
 *   2. *attempts* the things NEXA must never need — a filesystem write, a child
 *      process, a worker thread — and fails if the runtime does **not** deny them.
 *      Without step 2 the proof would be vacuous: "it ran under a sandbox" means
 *      nothing if the sandbox was open.
 *
 * Scope note, learned the hard way: Node's permission model does not gate sockets in
 * every version, so network access is *reported* rather than asserted here — an
 * earlier version of this script treated a reachable network as "sandbox open" and
 * failed on GitHub runners that have one. NEXA's no-network property is established
 * by `npm run posture` (no `node:net`/`node:http`/`node:tls` import anywhere in
 * `packages/` or `adapters/`) and by the fact that the whole demo runs with no I/O.
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

/**
 * Robust permission flag probing — report exactly how we were invoked and what
 * the permission model exposes. This helps CI distinguish between:
 *   - no permission model support (old Node)
 *   - permission model active but flag name differs (--permission vs --experimental-permission)
 *   - permission model active but mis-configured (missing --allow-fs-read)
 *
 * The actual probing of which flag is supported lives in tools/permission-probe.mjs,
 * which is the single source of truth for CI. This file is the proof itself.
 */
function probePermissionModel() {
  const info = {
    nodeVersion: process.version,
    permission: process.permission,
    execArgv: process.execArgv,
    argv: process.argv.slice(0, 3),
    hasPermission: process.permission !== undefined,
    flags: {
      permission: process.execArgv.includes('--permission'),
      experimentalPermission: process.execArgv.includes('--experimental-permission'),
      allowFsRead: process.execArgv.some(a => a.startsWith('--allow-fs-read')),
      allowFsWrite: process.execArgv.some(a => a.startsWith('--allow-fs-write')),
      allowChild: process.execArgv.some(a => a.startsWith('--allow-child-process')),
    },
  };
  return info;
}

const permInfo = probePermissionModel();

if (process.permission === undefined) {
  process.stderr.write(
    `permission model is not active — run \`npm run proof:permission\` ` +
    `(or on older Node: \`node --experimental-permission --allow-fs-read=. tools/permission-proof.mjs\`)\n` +
    `probe: node ${permInfo.nodeVersion} execArgv=${JSON.stringify(permInfo.execArgv)}\n` +
    `hint: use \`node tools/permission-probe.mjs --json\` to see which flag your Node supports\n`,
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
  const { Worker } = await import('node:worker_threads');
  const worker = new Worker('process.exit(0)', { eval: true });
  await worker.terminate();
  attempts.workerThread = 'ALLOWED';
} catch (error) {
  attempts.workerThread = error.code ?? error.message;
}

for (const name of ['filesystemWrite', 'childProcess', 'workerThread']) {
  if (attempts[name] === 'ALLOWED') {
    failures.push(`${name} was not denied — the proof would be vacuous`);
  }
}

// Reported, not asserted: the permission model does not gate sockets in every Node
// release, so a reachable network says nothing about NEXA either way. What matters is
// that nothing in the protocol surface can open one — that is what posture checks.
let network;
try {
  await fetch('https://example.com');
  network = 'reachable (not gated by this Node version — see posture scan)';
} catch (error) {
  network = `unreachable (${error.code ?? error.message})`;
}

if (failures.length > 0) {
  process.stderr.write('permission proof FAILED\n');
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write([
  'permission proof OK',
  `  probe: node ${permInfo.nodeVersion} flag=${permInfo.flags.permission ? '--permission' : permInfo.flags.experimentalPermission ? '--experimental-permission' : 'unknown'} execArgv=${JSON.stringify(permInfo.execArgv)}`,
  `  permission model: hasPermission=${permInfo.hasPermission} allowFsRead=${permInfo.flags.allowFsRead}`,
  `  protocol flow: ALLOW ${JSON.stringify(allowed.value)}, gate DENY ${denied.code}/${denied.reply.body.details.gate}`,
  `  evidence: ${chain.length} records, chain verified, ${endpoint.evidence.summary().length} kinds`,
  `  gates: ${gatePosture().map((gate) => gate.name).join(', ')} all CLOSED`,
  `  runtime denied: filesystem write (${attempts.filesystemWrite}), child process (${attempts.childProcess}), worker thread (${attempts.workerThread})`,
  `  network: ${network}`,
  '  protocol surface imports only node:crypto (see npm run posture)',
  '',
].join('\n'));
