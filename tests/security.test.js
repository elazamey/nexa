/**
 * Adversarial suite.
 *
 * Every test here is an attack attempt, written *before* the fix where the attack
 * succeeded. They are kept because a protocol's security properties are only as
 * good as the attacks that keep failing.
 *
 * Run alone: `npm run audit`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize, canonicalBytes, parseCanonical } from '../packages/ast/index.js';
import { KeyPair } from '../packages/crypto/index.js';
import { createIdentity, TrustStore } from '../packages/identity/index.js';
import {
  mintCapability,
  attenuate,
  verifyCapability,
  createRevocation,
  RevocationSet,
} from '../packages/capability/index.js';
import { Policy } from '../packages/policy/index.js';
import { Endpoint, buildEnvelope, MAX_BODY_BYTES } from '../packages/protocol/index.js';
import { EvidenceLog, verifyEvidenceChain, createReceipt } from '../packages/evidence/index.js';
import { McpBridge } from '../adapters/mcp/index.js';
import { throwsCode, world, capabilityFor, T0, SEEDS } from './helpers.mjs';

// ---------------------------------------------------------------------------
// S1. Canonicalization: ambiguity must be impossible, not merely unlikely
// ---------------------------------------------------------------------------

test('S1: keys that collide after NFC normalization are rejected, not silently merged', () => {
  // 'é' as U+00E9 and as U+0065 U+0301 are different JavaScript keys that normalize
  // to the same canonical key. Emitting `{"é":1,"é":2}` would be ambiguous downstream.
  const colliding = { é: 1, 'e\u0301': 2 };
  assert.equal(Object.keys(colliding).length, 2, 'precondition: two distinct JS keys');
  throwsCode(assert, () => canonicalize(colliding), 'NEXA_E_C14N_FORM');

  // ...and the collision does not have to be at the top level either.
  throwsCode(assert, () => canonicalize({ nested: { é: 1, 'e\u0301': 2 } }), 'NEXA_E_C14N_FORM');
  // A single non-NFC key is still fine: it is normalized, not rejected.
  assert.equal(canonicalize({ 'e\u0301': 1 }), '{"é":1}');
});

test('S1b: nesting does not create an escape hatch for illegal values', () => {
  // The same rejections must hold at every depth, including inside arrays.
  throwsCode(assert, () => canonicalize({ a: [{ b: { c: 1.5 } }] }), 'NEXA_E_C14N_NUMBER');
  throwsCode(assert, () => canonicalize([[['\ud800']]]), 'NEXA_E_C14N_STRING');
  throwsCode(assert, () => canonicalize({ a: { 'é': 1, 'e\u0301': 2 } }), 'NEXA_E_C14N_FORM');
  // Duplicate keys cannot be expressed in a JavaScript object, but they can in JSON
  // text — and there the re-encode check catches them.
  throwsCode(assert, () => parseCanonical('{"a":1,"a":2}'), 'NEXA_E_C14N_FORM');
  throwsCode(assert, () => parseCanonical('{"__proto__":1}'), 'NEXA_E_C14N_TYPE');
});

// ---------------------------------------------------------------------------
// S2. Authority must originate somewhere the endpoint trusts
// ---------------------------------------------------------------------------

test('S2: a trusted peer cannot mint itself authority that the operator never granted', () => {
  const scope = world();
  // `outsider` is pinned in the trust store, so it passes the sender-trust step.
  const selfIssued = mintCapability({
    issuer: scope.outsider,
    subject: scope.outsider.kid, // self-granted
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 5, max_depth: 0 },
  });
  const envelope = buildEnvelope({
    sender: scope.outsider,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: { text: 'self granted' }, capability: selfIssued },
    capability: selfIssued.id,
    id: 'urn:nexa:msg:SELFISSUEDSELFISSUE',
    nonce: 'SELFISSUEDSELFISSUE',
    now: T0,
  });
  const result = scope.endpoint.receive(envelope);
  assert.equal(result.decision, 'DENY', 'a self-issued capability must not satisfy the policy');
  assert.equal(result.code, 'NEXA_E_UNTRUSTED');
  assert.equal(scope.endpoint.evidence.entries().some((record) => record.kind === 'HANDLER_RESULT'), false);
});

test('S2b: verifyCapability can require specific issuers when used standalone', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.operator.kid });
  assert.equal(verifyCapability(capability, {
    presenter: scope.operator.kid,
    now: T0,
    trustedIssuers: [scope.operator.kid],
  }).grant.issuer, scope.operator.kid);
  throwsCode(assert, () => verifyCapability(capability, {
    presenter: scope.operator.kid,
    now: T0,
    trustedIssuers: [scope.worker.kid],
  }), 'NEXA_E_UNTRUSTED');
});

test('S2c: an endpoint accepts capability roots only from trusted operators', () => {
  const scope = world();
  const operatorCapability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  assert.equal(
    scope.endpoint.receive(scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability: operatorCapability })).decision,
    'ALLOW',
  );

  // A pinned *agent* is not an authority even though it is trusted.
  const agentIssued = mintCapability({
    issuer: scope.worker,
    subject: scope.worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 1, max_depth: 0 },
  });
  const envelope = buildEnvelope({
    sender: scope.worker,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: {}, capability: agentIssued },
    capability: agentIssued.id,
    id: 'urn:nexa:msg:AGENTISSUEDAGENTISS',
    nonce: 'AGENTISSUEDAGENTISS',
    now: T0,
  });
  assert.equal(scope.endpoint.receive(envelope).code, 'NEXA_E_UNTRUSTED');
});

// ---------------------------------------------------------------------------
// S3. Revocation must be attributable
// ---------------------------------------------------------------------------

test('S3: a third party cannot revoke someone else capability', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.operator.kid });

  // The attacker signs a perfectly valid revocation record — for a capability that
  // is not theirs. A verifier that keeps "a set of revoked ids" would deny here.
  const forged = createRevocation({ cap: capability.id, issuer: scope.outsider, ts: '2026-09-18T12:05:00Z' });
  const set = new RevocationSet();
  set.add(forged);

  // Attribution is the fix: the record must come from an issuer of the chain.
  assert.equal(set.has(capability.id), true, 'membership alone is not attribution');
  assert.equal(set.has(capability.id, { issuers: [scope.operator.kid] }), false);
  assert.equal(
    verifyCapability(capability, { presenter: scope.operator.kid, now: T0, revoked: set }).ok,
    true,
    'an unrelated issuer must not be able to revoke this capability',
  );

  // The real issuer can, and it sticks.
  const genuine = createRevocation({ cap: capability.id, issuer: scope.operator, ts: '2026-09-18T12:06:00Z' });
  set.add(genuine);
  throwsCode(
    assert,
    () => verifyCapability(capability, { presenter: scope.operator.kid, now: T0, revoked: set }),
    'NEXA_E_CAP_REVOKED',
  );
});

test('S3b: revoking a root still revokes everything delegated from it', () => {
  const scope = world();
  const parent = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, caveats: { max_depth: 1, max_uses: 5 } });
  const child = attenuate(parent, {
    delegator: scope.caller.identity,
    subject: scope.worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
  });
  const set = new RevocationSet();
  set.add(createRevocation({ cap: parent.id, issuer: scope.operator, ts: '2026-09-18T12:05:00Z' }));
  throwsCode(
    assert,
    () => verifyCapability(child, { presenter: scope.worker.kid, now: T0, revoked: set }),
    'NEXA_E_CAP_REVOKED',
  );
});

// ---------------------------------------------------------------------------
// S4. Cost control: oversized input must be refused before it is processed
// ---------------------------------------------------------------------------

test('S4: an oversized body is refused before signature verification', () => {
  const scope = world();
  const huge = { text: 'x'.repeat(MAX_BODY_BYTES + 1024) };
  const envelope = buildEnvelope({
    sender: scope.caller.identity,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: huge },
    id: 'urn:nexa:msg:HUGEPAYLOADHUGEPAY',
    nonce: 'HUGEPAYLOADHUGEPAY',
    now: T0,
  });
  assert.ok(canonicalBytes(envelope.body).length > MAX_BODY_BYTES);

  const result = scope.endpoint.receive(envelope);
  assert.equal(result.decision, 'REJECTED');
  assert.equal(result.code, 'NEXA_E_TOO_LARGE');
  assert.equal(result.reply, null, 'oversized input gets no reply and no receipt');
  assert.equal(scope.endpoint.evidence.length, 0, 'and never touches the evidence log');
});

// ---------------------------------------------------------------------------
// S5. Replay, freshness and ordering
// ---------------------------------------------------------------------------

test('S5: only cryptographically valid, unexpired envelopes consume replay state', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, caveats: { max_uses: 5 } });
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability });

  const tampered = { ...envelope, body: { ...envelope.body, args: { injected: true } } };
  assert.equal(scope.endpoint.receive(tampered).code, 'NEXA_E_SIG');
  assert.deepEqual(scope.endpoint.replay.size, { ids: 0, nonces: 0 }, 'invalid input must not consume replay slots');

  assert.equal(scope.endpoint.receive(envelope).decision, 'ALLOW');
  assert.equal(scope.endpoint.receive(envelope).code, 'NEXA_E_REPLAY');

  const expired = buildEnvelope({
    sender: scope.caller.identity,
    to: scope.agent.kid,
    type: 'CALL',
    body: { resource: 'tool:echo', action: 'call', args: {} },
    id: 'urn:nexa:msg:EXPIREDEXPIREDEXPI',
    nonce: 'EXPIREDEXPIREDEXPI',
    now: new Date('2026-09-18T11:00:00Z'),
  });
  assert.equal(scope.endpoint.receive(expired).code, 'NEXA_E_EXPIRED');
  assert.deepEqual(scope.endpoint.replay.size, { ids: 1, nonces: 1 });
});

// ---------------------------------------------------------------------------
// S6. Evidence: what the chain does NOT protect against
// ---------------------------------------------------------------------------

test('S6: truncating the log is undetectable locally, but a receipt exposes it', () => {
  const scope = world();
  const log = new EvidenceLog({ actor: scope.agent, clock: () => T0 });
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, detail: { n: 1 } });
  const second = log.append({ kind: 'POLICY_DECISION', decision: 'DENY', subject: scope.caller.kid, detail: { n: 2 } });
  const receipt = createReceipt({ record: second, actor: scope.agent, chainHead: log.head.hash });

  const truncated = log.entries().slice(0, 1);
  assert.equal(verifyEvidenceChain(truncated).ok, true, 'a truncated chain is internally consistent…');

  const truncatedHead = verifyEvidenceChain(truncated).head;
  assert.notEqual(truncatedHead, receipt.chain_head, '…but it cannot match a receipt that pinned the head');
  assert.equal(verifyEvidenceChain(log.entries()).head, receipt.chain_head);
});

test('S6b: a foreign record cannot be spliced in, and a co-signed continuation is reported', () => {
  const scope = world();
  const log = new EvidenceLog({ actor: scope.agent, clock: () => T0 });
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, detail: {} });

  // Attempt 1: append someone else's record as-is. It cannot chain, because the
  // seq and prev fields are committed by its own signature.
  const foreign = new EvidenceLog({ actor: scope.outsider, clock: () => T0 })
    .append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, detail: {} });
  const spliced = [...log.entries(), foreign];
  assert.throws(() => verifyEvidenceChain(spliced), /out of order|chain broken/);

  // Attempt 2: re-sequence the foreign record so it *would* chain. Its own hash and
  // signature commit to seq/prev, so this is caught as tampering — the chain cannot be
  // extended by anyone who does not already hold the log.
  const chained = { ...foreign, seq: 1, prev: log.head.hash };
  assert.throws(() => verifyEvidenceChain([...log.entries(), chained]), /modified after sealing/);

  // Consequently a chain produced through this API always has exactly one actor; the
  // `expectActor` option exists for logs assembled from other sources and turns any
  // other signer into a refusal rather than a silent co-author.
  assert.deepEqual(verifyEvidenceChain(log.entries()).actors, [scope.agent.kid]);
  throwsCode(assert, () => verifyEvidenceChain(log.entries(), { expectActor: scope.outsider.kid }), 'NEXA_E_UNTRUSTED');
});

// ---------------------------------------------------------------------------
// S7. Secrets must not leak through any serialized surface
// ---------------------------------------------------------------------------

test('S7: no serialized surface contains private key material', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  const allowed = scope.endpoint.receive(scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability }));
  const surfaces = [
    JSON.stringify(scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability })),
    JSON.stringify(allowed.reply),
    JSON.stringify(allowed.receipt),
    JSON.stringify(scope.endpoint.evidence.entries()),
    JSON.stringify(scope.endpoint.describe()),
    JSON.stringify(scope.operator.document),
    JSON.stringify(scope.operator.keys),
    JSON.stringify(new McpBridge({ endpoint: scope.endpoint }).posture()),
  ];
  for (const surface of surfaces) {
    assert.equal(surface.includes(SEEDS.operator), false, 'seed leaked');
    assert.equal(surface.includes(SEEDS.agent), false, 'seed leaked');
    assert.equal(surface.includes(SEEDS.worker), false, 'seed leaked');
    assert.equal(/seed|private/i.test(surface), false, `private material hinted in: ${surface.slice(0, 120)}`);
  }
  // The private key object itself is a KeyObject and is not serializable at all.
  assert.equal(JSON.stringify(scope.operator.keys).includes('"seed"'), false);
  assert.equal(typeof scope.operator.keys.seedHex, 'string', 'the getter exists, but nothing exports it');
});

// ---------------------------------------------------------------------------
// S8. MCP boundary
// ---------------------------------------------------------------------------

test('S8: the MCP bridge cannot be talked into authority or into a gated tool', () => {
  const scope = world();
  const bridge = new McpBridge({ endpoint: scope.endpoint });

  // No capability anywhere: denied, with a receipt, and no handler invocation.
  const denied = bridge.handleRpc(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: {} } },
    { caller: scope.operator, clock: () => T0 },
  );
  assert.equal(denied.error.code, -32001);
  assert.equal(scope.endpoint.evidence.entries().some((record) => record.kind === 'HANDLER_RESULT'), false);

  // The bridge must never accept a resource the gates refuse, even indirectly.
  scope.endpoint.registerHandler('fs:/tmp/scratch', () => ({ wrote: true }));
  throwsCode(assert, () => new McpBridge({ endpoint: scope.endpoint, expose: ['fs:/tmp/scratch'] }), 'NEXA_E_GATE');

  // A self-issued capability cannot buy access through MCP either.
  const selfIssued = mintCapability({
    issuer: scope.outsider,
    subject: scope.outsider.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 1, max_depth: 0 },
  });
  const viaSelf = bridge.handleRpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: {} } },
    { caller: scope.outsider, clock: () => T0, capability: selfIssued },
  );
  assert.equal(viaSelf.error.data.nexa_code, 'NEXA_E_UNTRUSTED');
});

// ---------------------------------------------------------------------------
// S9. No hidden execution path anywhere in the protocol surface
// ---------------------------------------------------------------------------

test('S9: the protocol packages never import execution or filesystem APIs', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const walk = (directory) => readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

  const forbidden = [
    /from\s+['"]node:child_process['"]/,
    /from\s+['"]node:fs['"]/,
    /from\s+['"]node:fs\/promises['"]/,
    /from\s+['"]node:net['"]/,
    /from\s+['"]node:http['"]/,
    /from\s+['"]node:dgram['"]/,
    /\b(eval|Function)\s*\(/,
    /process\.binding/,
  ];
  const files = [...walk(join(root, 'packages')), ...walk(join(root, 'adapters'))]
    .filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
  assert.ok(files.length > 20, 'sanity: the scan must actually see the sources');
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${file} matches ${pattern}`);
    }
  }
});

test('S9b: hostile policy or capability documents cannot smuggle in behaviour', () => {
  const scope = world();
  // Prototype pollution attempts are rejected as non-plain objects.
  throwsCode(assert, () => canonicalize(JSON.parse('{"__proto__":{"polluted":true}}')), 'NEXA_E_C14N_TYPE');
  // Rule objects must be plain data: a class instance can carry getters and a
  // crafted prototype chain, and the engine would evaluate it as if it were a rule.
  class Sneaky {
    constructor() {
      this.effect = 'ALLOW';
      this.resource = '*';
      this.actions = ['call'];
      this.id = 'sneaky';
    }
  }
  throwsCode(assert, () => new Policy({ rules: [new Sneaky()] }), 'NEXA_E_POLICY');

  const plain = Object.create(null);
  Object.assign(plain, { id: 'allow-all', effect: 'ALLOW', resource: '*', actions: ['call'] });
  const policy = new Policy({ rules: [plain] });
  assert.equal(policy.evaluate({
    resource: 'tool:echo',
    action: 'call',
    subject: scope.caller.kid,
    capability: {},
    signals: { signed: true },
  }).effect, 'ALLOW', 'a null-prototype rule is data, and is accepted');
  assert.equal(({}).polluted, undefined, 'nothing was polluted on Object.prototype');
});

test('S9c: unknown envelope, capability and receipt fields are refused', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability });
  // The unknown field is refused by schema validation, before signature checks:
  // an earlier refusal is a stronger one, and nothing unsigned ever gets weighed.
  assert.equal(scope.endpoint.receive({ ...envelope, exec: '/bin/sh' }).code, 'NEXA_E_SCHEMA');
  throwsCode(assert, () => verifyCapability({ ...capability, exec: '/bin/sh' }, { presenter: scope.operator.kid, now: T0 }), 'NEXA_E_CAP_INVALID');
  const log = new EvidenceLog({ actor: scope.agent, clock: () => T0 });
  throwsCode(
    assert,
    () => log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, exec: '/bin/sh' }),
    'NEXA_E_SCHEMA',
  );
});
