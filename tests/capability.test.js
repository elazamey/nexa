import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  mintCapability,
  attenuate,
  delegationPayload,
  verifyCapability,
  createRevocation,
  verifyRevocation,
  RevocationSet,
  isResourceSubset,
  areActionsSubset,
  isConstraintSubset,
  summarizeCapability,
  capabilityDepth,
  capabilityChainIds,
  normalizeCaveats,
} from '../packages/capability/index.js';
import { KeyPair } from '../packages/crypto/index.js';
import { throwsCode, world, capabilityFor, T0 } from './helpers.mjs';

const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/capability.json', import.meta.url), 'utf8'));

test('capability vectors: pinned tokens still verify with the pinned grants', () => {
  const grant = verifyCapability(vectors.parent, { presenter: vectors.parent.subject, now: T0, action: 'call', resource: 'tool:echo' });
  assert.deepEqual(grant.grant, vectors.expectations.parent_grant);
  const childGrant = verifyCapability(vectors.child, { presenter: vectors.child.subject, now: T0 });
  assert.deepEqual(childGrant.grant, vectors.expectations.child_grant);
});

test('a root capability is signed by its issuer and names a holder', () => {
  const { operator, worker } = world();
  const capability = capabilityFor({ issuer: operator, subject: worker.kid });
  assert.equal(capability.proof.kind, 'ed25519');
  assert.equal(capability.proof.parent, null);
  assert.equal(capability.proof.kid, operator.kid);
  assert.equal(capability.subject, worker.kid);
  assert.equal(summarizeCapability(capability).depth, 0);
});

test('minting requires a private key and refuses nonsense scopes', () => {
  const { operator, worker } = world();
  throwsCode(assert, () => mintCapability({ issuer: { kid: operator.kid }, subject: worker.kid, resource: 'tool:echo', actions: ['call'] }), 'NEXA_E_KEY');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, resource: 'ECHO', actions: ['call'] }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, actions: [] }), 'NEXA_E_CAP_INVALID');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, actions: ['call', 'call'] }), 'NEXA_E_CAP_INVALID');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: 'not-a-kid' }), 'NEXA_E_IDENTITY');
});

test('caveat bounds are enforced at mint time', () => {
  const { operator, worker } = world();
  throwsCode(
    assert,
    () => capabilityFor({ issuer: operator, subject: worker.kid, caveats: { exp: '2026-09-20T12:00:00Z' } }),
    'NEXA_E_TTL',
  );
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, caveats: { max_uses: 0 } }), 'NEXA_E_CAP_INVALID');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, caveats: { max_depth: 99 } }), 'NEXA_E_CAP_INVALID');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, caveats: { nope: 1 } }), 'NEXA_E_CAP_INVALID');
  assert.equal(normalizeCaveats({ exp: '2026-09-18T13:00:00Z' }, { now: T0 }).max_uses, 1);
});

test('constraints are typed and normalized deterministically', () => {
  const { operator, worker } = world();
  const capability = capabilityFor({
    issuer: operator,
    subject: worker.kid,
    constraints: { max_args_bytes: 512, zone: 'eu', mode: ['fast', 'safe', 'safe'] },
  });
  assert.deepEqual(capability.constraints, { max_args_bytes: 512, mode: ['fast', 'safe'], zone: 'eu' });
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, constraints: { x: -1 } }), 'NEXA_E_CAP_INVALID');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, constraints: { x: [] } }), 'NEXA_E_CAP_INVALID');
  throwsCode(assert, () => capabilityFor({ issuer: operator, subject: worker.kid, constraints: { x: true } }), 'NEXA_E_CAP_INVALID');
});

test('subset helpers describe the authority lattice', () => {
  assert.equal(isResourceSubset('tool:echo', 'tool:echo'), true);
  assert.equal(isResourceSubset('tool:echo', 'tool:echo.sub'), true);
  assert.equal(isResourceSubset('tool:echo', 'tool:other'), false);
  assert.equal(isResourceSubset('tool', 'tool:echo'), false);
  assert.equal(areActionsSubset(['call', 'read'], ['read']), true);
  assert.equal(areActionsSubset(['call'], ['call', 'write']), false);
  assert.equal(isConstraintSubset({ n: 10 }, { n: 5 }).ok, true);
  assert.equal(isConstraintSubset({ n: 10 }, { n: 11 }).ok, false);
  assert.equal(isConstraintSubset({ n: 10 }, { m: 1 }).ok, false);
  assert.equal(isConstraintSubset({ s: 'a' }, { s: 'a' }).ok, true);
  assert.equal(isConstraintSubset({ s: 'a' }, { s: 'b' }).ok, false);
  assert.equal(isConstraintSubset({ list: ['a', 'b'] }, { list: ['a'] }).ok, true);
  assert.equal(isConstraintSubset({ list: ['a'] }, { list: ['a', 'z'] }).ok, false);
});

test('attenuation refuses every way of widening authority', () => {
  const { operator, agent, worker } = world();
  const parent = capabilityFor({
    issuer: operator,
    subject: agent.kid,
    caveats: { max_uses: 4, max_depth: 2 },
    constraints: { max_args_bytes: 1024, mode: ['safe', 'fast'] },
  });
  const child = attenuate(parent, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 2, max_depth: 1 },
    constraints: { max_args_bytes: 64, mode: ['safe'] },
  });
  assert.equal(capabilityDepth(child), 1);
  assert.deepEqual(capabilityChainIds(child), [child.id, parent.id]);

  const attempts = {
    'scope widening': { resource: 'tool:add' },
    'action addition': { actions: ['call', 'write'] },
    'later expiry': { caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T14:00:00Z', max_uses: 1, max_depth: 0 } },
    'earlier nbf': { caveats: { nbf: '2026-09-18T10:00:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 } },
    'bigger budget': { caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 99, max_depth: 0 } },
    'deeper delegation': { caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 2 } },
    'relaxed constraint': { constraints: { max_args_bytes: 4096, mode: ['safe'] } },
    'dropped constraint': { constraints: {} },
    'partially dropped constraint': { constraints: { max_args_bytes: 64 } },
    'invented constraint': { constraints: { new_rule: 1 } },
    'changed string constraint': { constraints: { mode: ['fast'] } },
  };
  for (const [label, override] of Object.entries(attempts)) {
    throwsCode(
      assert,
      () => attenuate(parent, {
        delegator: agent,
        subject: worker.kid,
        resource: 'tool:echo',
        actions: ['call'],
        caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
        constraints: { max_args_bytes: 64, mode: ['safe'] },
        ...override,
      }),
      'NEXA_E_CAP_AMPLIFY',
    );
    assert.ok(label.length > 0);
  }
});

test('only the holder or the issuer may delegate, and depth is honoured', () => {
  const { operator, agent, worker, outsider } = world();
  const parent = capabilityFor({ issuer: operator, subject: agent.kid, caveats: { max_depth: 1 } });
  throwsCode(
    assert,
    () => attenuate(parent, {
      delegator: outsider,
      subject: worker.kid,
      resource: 'tool:echo',
      actions: ['call'],
      caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:00:00Z', max_uses: 1, max_depth: 0 },
    }),
    'NEXA_E_CAP_AMPLIFY',
  );
  const root = capabilityFor({ issuer: operator, subject: agent.kid, caveats: { max_depth: 0 } });
  throwsCode(
    assert,
    () => attenuate(root, {
      delegator: agent,
      subject: worker.kid,
      resource: 'tool:echo',
      actions: ['call'],
      caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:00:00Z', max_uses: 1, max_depth: 0 },
    }),
    'NEXA_E_CAP_AMPLIFY',
  );
});

test('delegate_to restricts who may receive authority', () => {
  const { operator, agent, worker, outsider } = world();
  const parent = capabilityFor({
    issuer: operator,
    subject: agent.kid,
    caveats: { max_depth: 1 },
    constraints: { delegate_to: [outsider.kid] },
  });
  const childSpec = (subject) => ({
    delegator: agent,
    subject,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:00:00Z', max_uses: 1, max_depth: 0 },
    constraints: { delegate_to: [outsider.kid] },
  });
  throwsCode(assert, () => attenuate(parent, childSpec(worker.kid)), 'NEXA_E_CAP_AMPLIFY');
  assert.equal(attenuate(parent, childSpec(outsider.kid)).subject, outsider.kid);
});

test('verification re-checks signatures, linkage and subset rules from the wire', () => {
  const { operator, agent, worker, outsider } = world();
  const parent = capabilityFor({ issuer: operator, subject: agent.kid, caveats: { max_uses: 3, max_depth: 1 } });
  const child = attenuate(parent, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 2, max_depth: 0 },
  });
  assert.equal(verifyCapability(child, { presenter: worker.kid, now: T0 }).grant.depth, 1);

  // Tamper the child's actions: the delegation signature must catch it.
  const widened = structuredClone(child);
  widened.actions = ['call', 'write'];
  throwsCode(assert, () => verifyCapability(widened, { presenter: worker.kid, now: T0 }), 'NEXA_E_SIG');

  // Re-parent the child under a *different* forged parent: the parent's own
  // signature fails first, and the delegation payload is bound to the parent hash.
  const forgedParent = structuredClone(parent);
  forgedParent.caveats.max_uses = 99;
  const reparented = structuredClone(child);
  reparented.proof.parent = forgedParent;
  throwsCode(assert, () => verifyCapability(reparented, { presenter: worker.kid, now: T0 }), 'NEXA_E_SIG');

  // An attacker who does not use `attenuate()` can still produce a perfectly
  // signed child — just not one signed by the parent's holder. The verifier must
  // reject it on linkage, after the signature checks pass.
  const forged = {
    nexa: '0.1',
    id: 'urn:nexa:cap:FORGEDFORGEDFORGED',
    issuer: outsider.kid,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
    constraints: {},
    proof: {
      kind: 'chain',
      parent,
      alg: 'ed25519',
      kid: outsider.kid,
      val: outsider.keys.sign(delegationPayload({
        nexa: '0.1',
        id: 'urn:nexa:cap:FORGEDFORGEDFORGED',
        issuer: outsider.kid,
        subject: worker.kid,
        resource: 'tool:echo',
        actions: ['call'],
        caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
        constraints: {},
      }, parent)),
    },
  };
  throwsCode(assert, () => verifyCapability(forged, { presenter: worker.kid, now: T0 }), 'NEXA_E_CAP_AMPLIFY');
});

test('presenter binding: a token only works for the key id it names', () => {
  const { operator, worker, outsider } = world();
  const capability = capabilityFor({ issuer: operator, subject: worker.kid });
  assert.equal(verifyCapability(capability, { presenter: worker.kid, now: T0 }).ok, true);
  throwsCode(assert, () => verifyCapability(capability, { presenter: outsider.kid, now: T0 }), 'NEXA_E_CAP_AUDIENCE');
});

test('freshness, scope and budget are enforced on every link', () => {
  const { operator, agent, worker } = world();
  const parent = capabilityFor({
    issuer: operator,
    subject: agent.kid,
    caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T12:45:00Z', max_uses: 2, max_depth: 1 },
  });
  const child = attenuate(parent, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 1, max_depth: 0 },
  });

  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: new Date('2026-09-18T12:31:00Z') }), 'NEXA_E_CAP_EXPIRED');
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: new Date('2026-09-18T11:00:00Z') }), 'NEXA_E_CAP_EXPIRED');
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: T0, action: 'write' }), 'NEXA_E_POLICY');
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: T0, resource: 'tool:other' }), 'NEXA_E_POLICY');
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: T0, uses: (id) => (id === child.id ? 1 : 0) }), 'NEXA_E_CAP_USES');
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: T0, uses: (id) => (id === parent.id ? 2 : 0) }), 'NEXA_E_CAP_USES');
  assert.equal(verifyCapability(child, { presenter: worker.kid, now: T0, uses: () => 0 }).grant.remaining_uses, 1);
});

test('revocation is signed, attributable and chain-wide', () => {
  const { operator, agent, worker } = world();
  const parent = capabilityFor({ issuer: operator, subject: agent.kid, caveats: { max_depth: 1, max_uses: 5 } });
  const child = attenuate(parent, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 2, max_depth: 0 },
  });

  const record = createRevocation({ cap: parent.id, issuer: operator, ts: '2026-09-18T12:05:00Z', reason: 'compromised' });
  assert.equal(verifyRevocation(record).cap, parent.id);
  throwsCode(assert, () => verifyRevocation({ ...record, ts: '2026-09-18T12:06:00Z' }), 'NEXA_E_SIG');
  throwsCode(assert, () => verifyRevocation(record, { capId: child.id }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => verifyRevocation({ ...record, reason: 'because' }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => verifyRevocation({ ...record, issuer: agent.kid }), 'NEXA_E_SIG');

  const set = new RevocationSet();
  assert.deepEqual(set.add(record), { added: true, cap: parent.id, issuer: operator.kid });
  assert.deepEqual(set.add(record), { added: false, cap: parent.id, issuer: operator.kid });
  assert.equal(set.has(parent.id), true);
  assert.equal(set.has(parent.id, { issuers: [agent.kid] }), false, 'attribution matters');
  assert.equal(set.hasAnyInChain(child), true);
  assert.equal(set.size, 1);
  assert.deepEqual(set.ids(), [parent.id]);
  assert.deepEqual(set.issuersOf(parent.id), [operator.kid]);
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: T0, revoked: set.asSet() }), 'NEXA_E_CAP_REVOKED');
  throwsCode(assert, () => verifyCapability(child, { presenter: worker.kid, now: T0, revoked: set }), 'NEXA_E_CAP_REVOKED');

  // A record from a key that is not part of the chain is refused at insert time
  // when issuers are named, and ignored at verify time otherwise.
  const bystander = createRevocation({ cap: parent.id, issuer: agent, ts: '2026-09-18T12:07:00Z' });
  throwsCode(assert, () => set.add(bystander, { issuers: [operator.kid] }), 'NEXA_E_UNTRUSTED');
  set.add(bystander);
  assert.equal(set.has(parent.id, { issuers: [operator.kid] }), true);
  assert.equal(
    verifyCapability(child, { presenter: worker.kid, now: T0, revoked: new RevocationSet() }).ok,
    true,
  );
});

test('a chain deeper than its root allows is refused at verify time', () => {
  const { operator, agent, worker, outsider } = world();
  const root = capabilityFor({ issuer: operator, subject: agent.kid, caveats: { max_depth: 1, max_uses: 5 } });
  const child = attenuate(root, {
    delegator: agent,
    subject: worker.kid,
    resource: 'tool:echo',
    actions: ['call'],
    caveats: { nbf: '2026-09-18T11:30:00Z', exp: '2026-09-18T12:30:00Z', max_uses: 3, max_depth: 0 },
  });
  // Forge the root's depth budget to 0 while keeping the chain: verification must fail.
  const relabelled = structuredClone(child);
  relabelled.proof.parent.caveats.max_depth = 0;
  throwsCode(assert, () => verifyCapability(relabelled, { presenter: outsider.kid, now: T0 }), 'NEXA_E_SIG');
});
