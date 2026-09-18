#!/usr/bin/env node
/**
 * The smallest complete NEXA flow:
 *
 *   1. two identities (operator, agent)
 *   2. an endpoint with a default-deny policy and one in-memory handler
 *   3. the operator mints a capability for the agent
 *   4. a signed CALL is ALLOWed, and a gated CALL is DENYed
 *   5. both decisions produce verifiable evidence and signed receipts
 *
 * Run it: `node examples/hello-nexa.mjs`
 *
 * It touches nothing: no files, no network, no commands. `run()` is exported so
 * the test suite can execute this exact flow without spawning a process.
 */
import { createIdentity } from '../packages/identity/index.js';
import { mintCapability } from '../packages/capability/index.js';
import { Policy, gatePosture } from '../packages/policy/index.js';
import { Endpoint } from '../packages/protocol/index.js';
import { verifyEvidenceChain, verifyReceipt } from '../packages/evidence/index.js';

// Piping into `head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

export const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

/**
 * @param {{log?: (...args: unknown[]) => void}} [options]
 * @returns {object} everything the flow produced, for inspection
 */
export function run({ log = console.log } = {}) {
  // 1. identities: key ids are self-certifying, labels are only metadata
  const operator = createIdentity({ label: 'operator', seed: '11'.repeat(32) });
  const agent = createIdentity({ label: 'agent-01', kind: 'agent', seed: '22'.repeat(32) });
  log(`operator ${operator.kid}`);
  log(`agent    ${agent.kid}`);

  // 2. the endpoint: default-deny policy, one pure in-memory handler
  const endpoint = new Endpoint({
    identity: agent,
    clock,
    capabilityIssuers: [operator.kid], // only the operator may grant this endpoint authority
    policy: new Policy({
      rules: [
        { id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'], description: 'echo is a pure function' },
      ],
    }),
  });
  endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
  endpoint.trust.pin(operator.document);

  // 3. authority exists only because the operator signed it
  const capability = mintCapability({
    issuer: operator,
    subject: operator.kid, // the holder: the only key id that may present it
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 5, max_depth: 0 },
    constraints: { max_args_bytes: 1024 },
  });
  log(`capability ${capability.id}`);

  const caller = new Endpoint({ identity: operator, clock });
  caller.trust.pin(agent.document);

  // 4a. an allowlisted, capability-backed call
  const allowed = endpoint.receive(
    caller.call({ to: agent.kid, resource: 'tool:echo', args: { text: 'hello nexa' }, capability }),
  );
  log(`ALLOW -> ${JSON.stringify(allowed.value)} (receipt ${verifyReceipt(allowed.receipt).summary.decision})`);

  // 4b. the same authority cannot touch a closed gate
  const denied = endpoint.receive(
    caller.call({ to: agent.kid, resource: 'fs:/etc/passwd', action: 'write', args: { data: 'x' }, capability }),
  );
  log(`DENY  -> ${denied.code} (${denied.reply.body.details.gate} gate, ${denied.record.kind})`);

  // 5. every decision is recorded and provable
  const chain = verifyEvidenceChain(endpoint.evidence.entries());
  log(`evidence: ${chain.length} records, chain ok=${chain.ok}, head=${chain.head}`);
  log(`gates: ${gatePosture().map((gate) => `${gate.name}=${gate.state}`).join(' ')}`);

  return { operator, agent, endpoint, capability, allowed, denied, chain };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  run();
}
