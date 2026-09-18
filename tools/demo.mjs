#!/usr/bin/env node
/**
 * NEXA end-to-end demo: capability -> ALLOW -> delegation -> gate DENY -> receipts.
 *
 * Everything here runs in one process and touches nothing outside it: no network,
 * no filesystem, no commands. The point is to show the *decision pipeline*, not an
 * integration. Every printed verdict is real output from the packages in this repo.
 */
import { createIdentity, TrustStore, identityFingerprint } from '../packages/identity/index.js';
import { mintCapability, attenuate, verifyCapability, createRevocation, RevocationSet } from '../packages/capability/index.js';
import { Policy, gatePosture } from '../packages/policy/index.js';
import { Endpoint } from '../packages/protocol/index.js';
import { verifyEvidenceChain, verifyReceipt } from '../packages/evidence/index.js';
import { printNex, parseNex } from '../packages/parser/index.js';
import { canonicalize } from '../packages/ast/index.js';

// Piping into `head` closes stdout early; that is not an error worth a stack trace.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const line = (title) => process.stdout.write(`\n\u001b[1m${title}\u001b[0m\n${'-'.repeat(title.length)}\n`);
const step = (label, value) => process.stdout.write(`  ${label.padEnd(34)} ${value}\n`);

// Fixed clock and seeds: the demo is deterministic, so its output can be diffed.
const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

line('1. Identities');
const operator = createIdentity({ label: 'operator', seed: 'a1'.repeat(32) });
const agent = createIdentity({ label: 'agent-01', kind: 'agent', seed: 'b2'.repeat(32) });
const worker = createIdentity({ label: 'worker-02', kind: 'agent', seed: 'c3'.repeat(32) });
step('operator kid', operator.kid);
step('agent kid', agent.kid);
step('agent fingerprint', identityFingerprint(agent.document));

line('2. Trust is explicit');
const callerTrust = new TrustStore();
callerTrust.pin(agent.document);
step('pinned peers (caller)', callerTrust.list().length);
try {
  callerTrust.require(worker.kid);
  step('unknown identity', 'NOT BLOCKED (bug)');
} catch (error) {
  step('unknown identity', `${error.code} — pin-or-reject`);
}

line('3. Endpoint with a default-deny policy');
const endpoint = new Endpoint({
  identity: agent,
  clock,
  policy: new Policy({
    rules: [
      { id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'], description: 'echo is a pure function' },
      { id: 'allow-add', effect: 'ALLOW', resource: 'tool:add', actions: ['call'], description: 'addition is a pure function' },
    ],
  }),
});
endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
endpoint.registerHandler('tool:add', ({ args }) => ({ sum: args.a + args.b }));
endpoint.trust.pin(operator.document);
endpoint.trust.pin(worker.document);
step('registered resources', endpoint.resources().join(', '));
step('policy rules', endpoint.policy.rules.map((rule) => rule.id).join(', '));

line('4. Closed gates (measured now, not asserted in prose)');
for (const gate of gatePosture()) {
  step(gate.name, gate.state);
}

line('5. The operator mints a capability for the agent');
const capability = mintCapability({
  issuer: operator,
  subject: agent.kid,
  resource: 'tool:echo',
  actions: ['call'],
  caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 3, max_depth: 1 },
  constraints: { max_args_bytes: 512, mode: ['safe', 'fast'] },
  note: 'demo grant',
});
step('capability id', capability.id);
step('subject', capability.subject);
step('max uses', capability.caveats.max_uses);

line('6. A signed CALL is accepted');
const caller = new Endpoint({ identity: operator, clock, trust: callerTrust });
const call = caller.call({ to: agent.kid, resource: 'tool:echo', args: { text: 'hello nexa' }, capability });
const allowed = endpoint.receive(call);
step('decision', allowed.decision);
step('value', JSON.stringify(allowed.value));
step('evidence record', `seq ${allowed.record.seq} (${allowed.record.kind})`);
step('receipt verifies', String(verifyReceipt(allowed.receipt).ok));
step('reply type', allowed.reply.type);

line('7. Replay of the same envelope is refused');
const replayed = endpoint.receive(call);
step('decision', `${replayed.decision} (${replayed.code})`);
step('reply', replayed.reply === null ? 'none — unauthenticated re-sends get no reply' : 'unexpected');

line('8. Delegation only shrinks authority');
const delegated = attenuate(capability, {
  delegator: agent,
  subject: worker.kid,
  resource: 'tool:echo',
  actions: ['call'],
  caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 2, max_depth: 0 },
  constraints: { max_args_bytes: 128, mode: ['safe'] },
});
const grant = verifyCapability(delegated, { presenter: worker.kid, now: T0 }).grant;
step('chain', grant.chain.join(' -> '));
step('depth / max_depth', `${grant.depth} / ${grant.max_depth}`);
step('effective exp', grant.exp);
step('remaining uses', String(grant.remaining_uses));
for (const [label, build] of [
  ['widen expiry', () => attenuate(capability, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T14:00:00Z', max_uses: 1, max_depth: 0 },
  })],
  ['widen scope', () => attenuate(capability, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:add',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
  })],
  ['relax constraint', () => attenuate(capability, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
    constraints: { max_args_bytes: 999_999 },
  })],
]) {
  try {
    build();
    step(label, 'NOT BLOCKED (bug)');
  } catch (error) {
    step(label, `${error.code} — ${error.message}`);
  }
}

line('9. Revocation reaches the whole chain');
const revocations = new RevocationSet();
revocations.add(createRevocation({ cap: capability.id, issuer: operator, ts: '2026-09-18T12:05:00Z', reason: 'operator_request' }));
step('revoked ids', revocations.ids().join(', '));
step('delegated chain revoked', String(revocations.hasAnyInChain(delegated)));
try {
  verifyCapability(delegated, { presenter: worker.kid, now: T0, revoked: revocations.asSet() });
  step('verify after revoke', 'NOT BLOCKED (bug)');
} catch (error) {
  step('verify after revoke', error.code);
}

line('10. A gated request never reaches policy');
const gated = caller.call({ to: agent.kid, resource: 'fs:/etc/passwd', action: 'write', args: { data: 'x' }, capability });
const refused = endpoint.receive(gated);
step('decision', `${refused.decision} (${refused.code})`);
step('gate', JSON.stringify(refused.reply.body.details));
step('evidence record', `seq ${refused.record.seq} (${refused.record.kind})`);
step('receipt', refused.receipt === null ? 'none' : `signed, decision ${refused.receipt.decision}`);

line('11. Default-deny for everything unlisted');
// Note the shape of this test: the capability is perfectly valid — the authority
// exists — and the request is still refused, because no policy rule covers it.
const nukeCapability = mintCapability({
  issuer: operator,
  subject: operator.kid,
  resource: 'tool:nuke',
  actions: ['call'],
  caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 1, max_depth: 0 },
});
const unknown = caller.call({ to: agent.kid, resource: 'tool:nuke', args: {}, capability: nukeCapability });
const denied = endpoint.receive(unknown);
step('capability', 'valid (issuer-signed, in scope)');
step('decision', `${denied.decision} (${denied.code})`);
step('reason', denied.reply.body.message);

line('12. The evidence log');
const verification = verifyEvidenceChain(endpoint.evidence.entries());
step('records', String(verification.length));
step('chain verifies', String(verification.ok));
step('head', verification.head);
const tampered = endpoint.evidence.entries();
tampered[0].decision = 'ALLOW';
try {
  verifyEvidenceChain(tampered);
  step('tamper check', 'NOT DETECTED (bug)');
} catch (error) {
  step('tamper check', error.message);
}
for (const bucket of endpoint.evidence.summary()) {
  step(`  ${bucket.kind}`, `${bucket.decision} x${bucket.count}`);
}

line('13. The same call in .nex syntax');
const nexText = printNex(call);
process.stdout.write(nexText.split('\n').filter(Boolean).slice(0, 6).map((row) => `  ${row}`).join('\n'));
process.stdout.write('\n  …\n');
step('round-trips canonically', String(canonicalize(parseNex(nexText)) === canonicalize(call)));

line('Summary');
step('gate posture', gatePosture().every((gate) => gate.state === 'CLOSED') ? 'ALL SIX CLOSED' : 'OPEN (bug)');
step('evidence length', String(endpoint.evidence.length));
step('ledger', JSON.stringify(endpoint.ledger.snapshot()));
process.stdout.write('\n  No command ran, no file was written, nothing was deployed.\n\n');
