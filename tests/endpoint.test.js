import test from 'node:test';
import assert from 'node:assert/strict';

import { Endpoint } from '../packages/protocol/index.js';
import { Policy } from '../packages/policy/index.js';
import { verifyEvidenceChain, verifyReceipt, matchReceiptToRecord } from '../packages/evidence/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { buildEnvelope } from '../packages/protocol/src/envelope.js';
import { attenuate } from '../packages/capability/index.js';
import { throwsCode, world, capabilityFor, T0, SEEDS } from './helpers.mjs';

test('an allowlisted call with a valid capability is ALLOWed, spent and receipted', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, caveats: { max_uses: 2 } });
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: { text: 'hi' }, capability });
  const result = scope.endpoint.receive(envelope);

  assert.equal(result.decision, 'ALLOW');
  assert.deepEqual(result.value, { echoed: { text: 'hi' } });
  assert.equal(result.reply.type, 'RESULT');
  assert.equal(result.reply.in_reply_to, envelope.id);
  assert.equal(result.reply.body.ref, result.record.hash);
  assert.equal(verifyReceipt(result.reply.body.receipt).summary.decision, 'ALLOW');
  assert.equal(matchReceiptToRecord(result.receipt, result.record).ok, true);
  assert.equal(scope.endpoint.ledger.used(capability.id), 1);
  assert.deepEqual(verifyEvidenceChain(scope.endpoint.evidence.entries()).ok, true);
});

test('the decision pipeline refuses in the documented order', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });

  // 5. gate: blocked before policy is even consulted.
  const gated = scope.endpoint.receive(
    scope.caller.call({ to: scope.agent.kid, resource: 'terminal:main', action: 'exec', args: {}, capability }),
  );
  assert.equal(gated.code, 'NEXA_E_GATE');
  assert.equal(gated.reply.body.details.gate, 'TERMINAL');
  assert.equal(gated.record.kind, 'GATE_BLOCKED');
  assert.equal(gated.receipt.decision, 'DENY');

  // 6. capability: valid token, wrong holder.
  const stolen = buildEnvelope({
    sender: scope.worker,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: {}, capability },
    capability: capability.id,
    id: 'urn:nexa:msg:STOLENSTOLENSTOLENST',
    nonce: 'STOLENSTOLENSTOLENST',
    now: T0,
  });
  const presented = scope.endpoint.receive(stolen);
  assert.equal(presented.code, 'NEXA_E_CAP_AUDIENCE');
  assert.equal(presented.record.kind, 'CAPABILITY_REJECTED');

  // 7. policy: valid capability for the caller, but no rule covers the resource.
  const unscoped = capabilityFor({
    issuer: scope.operator,
    subject: scope.caller.kid,
    resource: 'tool:nuke',
  });
  const denied = scope.endpoint.receive(
    scope.caller.call({ to: scope.agent.kid, resource: 'tool:nuke', args: {}, capability: unscoped }),
  );
  assert.equal(denied.code, 'NEXA_E_POLICY');
  assert.equal(denied.record.kind, 'POLICY_DECISION');
  assert.match(denied.reply.body.message, /no rule matched/);

  // 8. handler missing: the policy allowed it, the endpoint cannot serve it.
  scope.endpoint.policy = new Policy({ rules: [{ id: 'allow-all', effect: 'ALLOW', resource: 'tool:*', actions: ['call'] }] });
  const noHandler = scope.endpoint.receive(
    scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo2', args: {}, capability: capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, resource: 'tool:echo2' }) }),
  );
  assert.equal(noHandler.code, 'NEXA_E_NO_HANDLER');
  assert.equal(noHandler.record.kind, 'HANDLER_RESULT');

  // 8b. handler failure is a recorded DENY, never a crash.
  const boom = scope.endpoint.receive(
    scope.caller.call({ to: scope.agent.kid, resource: 'tool:boom', args: {}, capability: capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, resource: 'tool:boom' }) }),
  );
  assert.equal(boom.code, 'NEXA_E_HANDLER');
  assert.equal(boom.reply.body.details.reason, 'handler exploded');
});

test('untrusted senders are refused and never reach policy or a handler', () => {
  const scope = world();
  scope.endpoint.trust.revoke(scope.outsider.kid);
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.outsider.kid });
  const envelope = buildEnvelope({
    sender: scope.outsider,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: {}, capability },
    capability: capability.id,
    id: 'urn:nexa:msg:OUTSIDEROUTSIDEROUT',
    nonce: 'OUTSIDEROUTSIDEROUT',
    now: T0,
  });
  const result = scope.endpoint.receive(envelope);
  assert.equal(result.decision, 'DENY');
  assert.equal(result.code, 'NEXA_E_UNTRUSTED');
  assert.equal(result.record.kind, 'PEER_REVOKED');
  assert.equal(scope.endpoint.evidence.entries().some((record) => record.kind === 'POLICY_DECISION'), false);
});

test('an unknown peer cannot even reach the trust layer', () => {
  const scope = world();
  const stranger = createIdentity({ label: 'stranger', kind: 'peer', seed: 'e5'.repeat(32) });
  const envelope = buildEnvelope({
    sender: stranger,
    to: scope.agent.kid,
    type: 'HELLO',
    body: { identity: stranger.document },
    id: 'urn:nexa:msg:STRANGERSTRANGERSTR',
    nonce: 'STRANGERSTRANGERSTR',
    now: T0,
  });
  const result = scope.endpoint.receive(envelope);
  assert.equal(result.code, 'NEXA_E_UNTRUSTED');
  assert.equal(scope.endpoint.trust.isTrusted(stranger.kid), false, 'HELLO must not pin trust implicitly');
});

test('replay, expiry and misaddressed envelopes never touch the endpoint state', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, caveats: { max_uses: 5 } });
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: { text: 'once' }, capability });

  assert.equal(scope.endpoint.receive(envelope).decision, 'ALLOW');
  const replay = scope.endpoint.receive(envelope);
  assert.equal(replay.decision, 'REJECTED');
  assert.equal(replay.code, 'NEXA_E_REPLAY');
  assert.equal(scope.endpoint.ledger.used(capability.id), 1, 'a replay must not spend budget');

  // The same envelope is accepted while it is fresh and refused once it is not.
  const shortLived = buildEnvelope({
    sender: scope.caller.identity,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: {}, capability: capabilityFor({ issuer: scope.operator, subject: scope.caller.kid }) },
    id: 'urn:nexa:msg:EXPIREDEXPIREDEXPI',
    nonce: 'EXPIREDEXPIREDEXPI',
    now: T0,
    ttlSeconds: 30,
  });
  assert.equal(scope.endpoint.receive(shortLived).decision, 'ALLOW');
  const otherClock = new Endpoint({ identity: scope.agent, clock: () => new Date('2026-09-18T12:05:00Z'), policy: scope.endpoint.policy });
  otherClock.trust.pin(scope.operator.document);
  const tooLate = otherClock.receive(shortLived);
  assert.equal(tooLate.decision, 'REJECTED');
  assert.equal(tooLate.code, 'NEXA_E_EXPIRED');
  assert.equal(otherClock.evidence.length, 0, 'an expired envelope leaves no evidence in the log it never entered');

  const misaddressed = scope.caller.call({ to: scope.worker.kid, resource: 'tool:echo', args: {} });
  const wrongTarget = scope.endpoint.receive(misaddressed);
  assert.equal(wrongTarget.decision, 'REJECTED');
  assert.equal(wrongTarget.code, 'NEXA_E_UNTRUSTED');
});

test('a dry run decides without consuming authority or invoking the handler', () => {
  const scope = world();
  let invocations = 0;
  scope.endpoint.registerHandler('tool:add', ({ args }) => {
    invocations += 1;
    return { sum: args.a + args.b };
  });
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, resource: 'tool:add', caveats: { max_uses: 1 } });

  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:add', args: { a: 1, b: 2 }, capability });
  const preview = scope.endpoint.receive(envelope, { execute: false });
  assert.equal(preview.decision, 'ALLOW');
  assert.deepEqual(preview.value, { dry_run: true });
  assert.equal(invocations, 0);
  assert.equal(scope.endpoint.ledger.used(capability.id), 0);

  const real = scope.endpoint.receive(scope.caller.call({ to: scope.agent.kid, resource: 'tool:add', args: { a: 1, b: 2 }, capability }));
  assert.deepEqual(real.value, { sum: 3 });
  assert.equal(invocations, 1);
  assert.equal(scope.endpoint.ledger.used(capability.id), 1);
});

test('capability constraints bound the arguments', () => {
  const scope = world();
  const capability = capabilityFor({
    issuer: scope.operator,
    subject: scope.caller.kid,
    constraints: { max_args_bytes: 32 },
  });
  const oversized = scope.caller.call({
    to: scope.agent.kid,
    resource: 'tool:echo',
    args: { text: 'x'.repeat(128) },
    capability,
  });
  const result = scope.endpoint.receive(oversized);
  assert.equal(result.decision, 'DENY');
  assert.equal(result.code, 'NEXA_E_POLICY');
  assert.match(result.reply.body.message, /constraints/);
});

test('a delegated capability consumes the whole chain budget', () => {
  const scope = world();
  const parent = capabilityFor({
    issuer: scope.operator,
    subject: scope.caller.kid,
    caveats: { max_uses: 2, max_depth: 1 },
  });
  const child = attenuate(parent, {
    delegator: scope.caller.identity,
    subject: scope.worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 2, max_depth: 0 },
  });

  const call = (nonce) => buildEnvelope({
    sender: scope.worker,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: { text: 'x' }, capability: child },
    capability: child.id,
    id: `urn:nexa:msg:${nonce}`,
    nonce,
    now: T0,
  });

  assert.equal(scope.endpoint.receive(call('CHAINUSECHAINUSECHA')).decision, 'ALLOW');
  assert.equal(scope.endpoint.ledger.used(child.id), 1);
  assert.equal(scope.endpoint.ledger.used(parent.id), 1, 'the parent budget is spent too');
  assert.equal(scope.endpoint.receive(call('CHAINUSECHAINUSEch')).decision, 'ALLOW');
  const third = scope.endpoint.receive(call('CHAINUSECHAINUSEc3'));
  assert.equal(third.decision, 'DENY');
  assert.equal(third.code, 'NEXA_E_CAP_USES');
  assert.equal(scope.endpoint.ledger.used(parent.id), 2);
});

test('HELLO answers with the identity document but pins nothing', () => {
  const scope = world();
  const reply = scope.endpoint.receive(scope.caller.hello(scope.agent.kid));
  assert.equal(reply.decision, 'ALLOW');
  assert.equal(reply.reply.type, 'RESULT');
  assert.equal(reply.reply.body.hello.kid, scope.agent.kid);
  assert.equal(scope.endpoint.trust.isTrusted(scope.caller.kid), true, 'already pinned by the test world');
});

test('describe() reports posture without leaking private material', () => {
  const scope = world();
  const empty = scope.endpoint.describe();
  assert.equal(empty.evidence_length, 0);
  assert.equal(empty.evidence_head, null);

  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  scope.endpoint.receive(scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability }));
  const description = scope.endpoint.describe();
  assert.equal(description.kid, scope.agent.kid);
  assert.deepEqual(description.resources, ['tool:add', 'tool:boom', 'tool:echo']);
  assert.equal(description.policy.defaultEffect, 'DENY');
  assert.equal(typeof description.evidence_head, 'string');
  assert.equal(description.evidence_length > 0, true);
  assert.equal(JSON.stringify(description).includes('"seed"'), false);
  assert.equal(JSON.stringify(description).includes(SEEDS.agent), false);
});

test('an endpoint without a signing identity is refused', () => {
  throwsCode(assert, () => new Endpoint({ identity: { kid: 'nexa:key:ed25519:zNOPE' } }), 'NEXA_E_KEY');
  const scope = world();
  throwsCode(assert, () => scope.endpoint.registerHandler('tool:x', 'not a function'), 'NEXA_E_HANDLER');
});

test('a signed envelope with a malformed resource or action is denied, not thrown', () => {
  const scope = world();
  const cases = [
    ['NOPE', 'call'],
    ['tool:echo', 'CALL!'],
    ['', 'call'],
    ['tool:echo', ''],
    ['tool:ECHO', 'call'],
  ];
  for (const [resource, action] of cases) {
    const envelope = buildEnvelope({
      sender: scope.caller.identity,
      to: scope.agent.kid,
      type: 'CALL',
      body: { resource, action, args: {} },
      id: `urn:nexa:msg:${Buffer.from(`${resource}/${action}`).toString('base64url').padEnd(22, 'A').slice(0, 22)}`,
      nonce: Buffer.from(`${action}/${resource}`).toString('base64url').padEnd(22, 'B').slice(0, 22),
      now: T0,
    });
    const result = scope.endpoint.receive(envelope);
    assert.equal(result.decision, 'DENY', `${resource}/${action}`);
    assert.equal(result.code, 'NEXA_E_SCHEMA', `${resource}/${action}`);
    assert.equal(result.receipt.decision, 'DENY');
    assert.equal(verifyReceipt(result.reply.body.receipt).ok, true);
  }
  // The endpoint survived every malformed request and recorded each refusal
  // (one ACCEPTED record for the envelope, one REJECTED record for the shape).
  const records = scope.endpoint.evidence.entries();
  assert.equal(records.length, cases.length * 2);
  assert.equal(records.some((record) => record.decision === 'ALLOW'), false);
  assert.equal(records.some((record) => record.kind === 'HANDLER_RESULT'), false);
  assert.equal(verifyEvidenceChain(records).ok, true);
});

test('a handler that returns non-canonical data is a recorded failure', () => {
  const scope = world();
  scope.endpoint.registerHandler('tool:weird', () => ({ when: new Date(0) }));
  scope.endpoint.policy = new Policy({ rules: [{ id: 'allow-weird', effect: 'ALLOW', resource: 'tool:weird', actions: ['call'] }] });
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, resource: 'tool:weird' });
  const result = scope.endpoint.receive(scope.caller.call({ to: scope.agent.kid, resource: 'tool:weird', args: {}, capability }));
  assert.equal(result.decision, 'DENY');
  assert.equal(result.code, 'NEXA_E_HANDLER');
  assert.equal(scope.endpoint.ledger.used(capability.id), 0, 'a failed handler must not spend budget');
});
