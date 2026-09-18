/**
 * GOOGLE IDENTITY CELL v1 — group 2: owner binding, revocation and break-glass.
 *
 * The subject of this file is the difference between *identity* and *authority*. Google proves a
 * subject; a binding is what makes a subject the owner of an instance, and only a key the
 * operator layer trusts may create one. Nothing in this file can be reached by a login — that is
 * the point, and one of the tests asserts it rather than assuming it.
 *
 * Break-glass gets the most attention because it is the one place where the design deliberately
 * creates a second path to authority. Every rule the contract names is tested as a refusal: a
 * recovery state that could live longer than a day, name a role other than `recovery`, chain,
 * delegate, touch the kernel, or survive a legitimate re-binding would be an authority nobody
 * approved.
 *
 * Run alone: `node --test tests/google-binding.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdentity } from '../packages/identity/index.js';
import { BREAK_GLASS_MAX_MS, createBindingRecord, subHash, verifyBinding } from '../packages/cells/google/identity/index.js';
import { assertWithinCeiling, googleOperation } from '../packages/cells/google/gateway/index.js';
import { SUBJECTS, fixture } from './google-helpers.mjs';

const OWNER_HASH = subHash(SUBJECTS.owner);
const RECOVERY_HASH = subHash(SUBJECTS.attacker);

/** A vault stand-in that records what happened to the material. */
function fakeVault() {
  const calls = [];
  return {
    calls,
    deleteFor(sub_hash) {
      calls.push(sub_hash);
      return 2; // two services had material for this subject
    },
  };
}

/** @returns {object} a fresh organ with a binding registry, and the identities involved */
function organ({ vault = null } = {}) {
  const fixtureValue = fixture({ vault });
  const stranger = createIdentity({ label: 'stranger', kind: 'agent', seed: '66'.repeat(32) });
  return { ...fixtureValue, stranger };
}

test('google/binding: a binding is created by the operator key and carries a signature', () => {
  const { google, owner } = organ();
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  assert.equal(binding.binding, 'owner');
  assert.equal(binding.role, 'owner');
  assert.equal(binding.method, 'invitation');
  assert.equal(binding.created_by, binding.sig.kid);
  assert.equal(binding.sub_hash, OWNER_HASH);
  assert.equal(typeof binding.evidence, 'string');
  verifyBinding(binding, { operatorKid: google.operator.kid });
});

test('google/binding: a binding made by a stranger is signed and still refused', () => {
  const { google, owner, stranger } = organ();
  // A perfectly well-formed record, signed by a real key — just not the key this instance trusts.
  const forged = createBindingRecord({ operator: stranger, sub_hash: OWNER_HASH, nexa_kid: owner.kid, created_at: '2026-09-18T12:00:00Z' });
  assert.throws(() => verifyBinding(forged, { operatorKid: google.operator.kid }), (error) => error.code === 'OMEGA_E_NOT_ACTIVATOR');
  // And the registry refuses the attempt itself, before a record exists.
  assert.throws(() => google.bindings.create({ created_by: stranger.kid, sub_hash: OWNER_HASH, nexa_kid: owner.kid }), (error) => error.code === 'OMEGA_E_NOT_ACTIVATOR');
  assert.equal(google.bindings.active(), null);
});

test('google/binding: a binding whose role was edited after signing is refused by the signature', () => {
  const { google, owner } = organ();
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  const edited = { ...binding, role: 'admin' };
  assert.throws(() => verifyBinding(edited, { operatorKid: google.operator.kid }), (error) => error.code === 'OMEGA_E_SIGNATURE');
  const editedSubject = { ...binding, sub_hash: subHash(SUBJECTS.attacker) };
  assert.throws(() => verifyBinding(editedSubject), (error) => error.code === 'OMEGA_E_SIGNATURE');
});

test('google/binding: a binding is keyed by the subject hash, and an email is not a key', () => {
  const { google, owner } = organ();
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  // There is no email field in the record at all: the *shape* is the guarantee that a changed
  // display name cannot move authority, and that a support engineer cannot bind by email.
  assert.equal(Object.hasOwn(binding, 'email'), false);
  assert.equal(Object.hasOwn(binding, 'email_hash'), false);
  assert.equal(google.bindings.activeFor(OWNER_HASH).nexa_kid, owner.kid);
  assert.equal(google.bindings.activeFor('canyoudfg@gmail.com'), null, 'an email is not a binding key');
});

test('google/binding: a binding names a NEXA key id, and a malformed one is refused', () => {
  const { google } = organ();
  for (const nexa_kid of ['owner@example.com', 'ed25519:abc', '', null]) {
    assert.throws(
      () => google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid }),
      (error) => error.code === 'OMEGA_E_IDENTITY' || error.code === 'OMEGA_E_SCHEMA',
      `${String(nexa_kid)} was accepted as a key id`,
    );
  }
});

test('google/binding: one subject, one live binding — a second is refused with its own code', () => {
  const { google, owner } = organ();
  google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  assert.throws(
    () => google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid }),
    (error) => error.code === 'OMEGA_E_BINDING_EXISTS',
  );
  assert.equal(google.bindings.history().length, 1);
});

test('google/binding: an expired binding is refused, not honoured with a warning', () => {
  const { google, owner } = organ();
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid, expires_at: '2026-09-18T13:00:00Z' });
  verifyBinding(binding, { operatorKid: google.operator.kid, now: new Date('2026-09-18T12:30:00Z') });
  assert.throws(
    () => verifyBinding(binding, { operatorKid: google.operator.kid, now: new Date('2026-09-18T14:00:00Z') }),
    (error) => error.code === 'OMEGA_E_IDENTITY',
  );
});

test('google/binding: delegation is refused — authority does not arrive second-hand', () => {
  const { google, owner, stranger } = organ();
  assert.throws(
    () => createBindingRecord({ operator: google.operator, sub_hash: OWNER_HASH, nexa_kid: owner.kid, created_at: '2026-09-18T12:00:00Z', delegated_by: stranger.kid }),
    (error) => error.code === 'OMEGA_E_NOT_ACTIVATOR',
  );
});

test('google/binding: a login cannot create a binding — the two paths do not touch', () => {
  const { google, owner, tokenFor } = organ();
  const challenge = google.begin();
  const token = tokenFor({ nonce: challenge });
  const login = google.login({ token, nonce: challenge });
  assert.equal(login.ok, true);
  // The principal is not a binding, and the organ exposes no path from one to the other.
  assert.equal(google.bindings.active(), null, 'a successful login created a binding');
  assert.equal(google.bindings.activeFor(login.principal.sub_hash), null);
  assert.equal(Object.hasOwn(login.principal, 'binding'), false);
  // The binding the operator creates afterwards is keyed by the same subject hash — the *only*
  // thing the login contributed.
  const binding = google.bindOwner({ sub_hash: login.principal.sub_hash, nexa_kid: owner.kid });
  assert.equal(binding.sub_hash, login.principal.sub_hash);
});

// --- break-glass: a recovery state, bounded on every side -----------------------------

test('google/binding: break-glass must be a recovery state and nothing else', () => {
  const { google, owner } = organ();
  assert.throws(
    () => google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account', role: 'owner' }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_ROLE',
  );
  assert.throws(
    () => google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account', role: 'admin' }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_ROLE',
  );
});

test('google/binding: break-glass without a reason is refused — an unauditable recovery is not recovery', () => {
  const { google, owner } = organ();
  assert.throws(
    () => google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: '   ' }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_REASON',
  );
  assert.throws(
    () => google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: null }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_REASON',
  );
});

test('google/binding: break-glass lives at most 24 hours, and an hour longer is unbounded', () => {
  const { google, owner } = organ();
  assert.equal(BREAK_GLASS_MAX_MS, 24 * 60 * 60 * 1000);
  for (const hours of [25, 48, 24.5, 0, -1]) {
    assert.throws(
      () => google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account', hours }),
      (error) => error.code === 'OMEGA_E_BREAKGLASS_UNBOUNDED',
      `${hours} hours was accepted`,
    );
  }
  // The boundary itself is legal, and it is the *only* legal end of the range.
  const binding = google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account', hours: 24 });
  assert.equal(binding.expires_at, '2026-09-19T12:00:00Z');
});

test('google/binding: a break-glass record with no expiry is refused as a shape, not as a policy', () => {
  const { google, owner } = organ();
  assert.throws(
    () => createBindingRecord({
      operator: google.operator,
      sub_hash: RECOVERY_HASH,
      nexa_kid: owner.kid,
      role: 'recovery',
      method: 'break-glass',
      created_at: '2026-09-18T12:00:00Z',
      expires_at: null,
      reason: 'lost the account',
    }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_UNBOUNDED',
  );
});

test('google/binding: break-glass does not chain', () => {
  const { google, owner } = organ();
  google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account' });
  assert.throws(
    () => google.breakGlass({ sub_hash: subHash(SUBJECTS.other), nexa_kid: owner.kid, reason: 'also lost' }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_CHAIN',
  );
});

test('google/binding: break-glass may not be delegated, even by the operator', () => {
  const { google, owner, stranger } = organ();
  assert.throws(
    () => createBindingRecord({
      operator: google.operator,
      sub_hash: RECOVERY_HASH,
      nexa_kid: owner.kid,
      role: 'recovery',
      method: 'break-glass',
      created_at: '2026-09-18T12:00:00Z',
      expires_at: '2026-09-18T18:00:00Z',
      reason: 'lost the account',
      delegated_by: stranger.kid,
    }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_CHAIN',
  );
});

test('google/binding: break-glass may not touch the kernel — not with a recovery state', () => {
  const { google, owner } = organ();
  for (const target of ['capability-authority@1', 'policy-engine@2', 'verifier@1', 'omega-kernel@3']) {
    assert.throws(
      () => google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'recovering', changes: [{ target }] }),
      (error) => error.code === 'OMEGA_E_KERNEL_IMMUTABLE',
      `${target} was accepted as a recovery target`,
    );
  }
  // A non-kernel target is accepted: recovery may repair an instance, never re-define it.
  const binding = google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'recovering', changes: [{ target: 'tool-selection@4' }] });
  assert.deepEqual(binding.changes, [{ target: 'tool-selection@4' }]);
});

test('google/binding: a recovery state reaches identity verification and nothing above class A', () => {
  const { google, owner } = organ();
  const binding = google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account' });
  assert.equal(binding.role, 'recovery');
  assertWithinCeiling({ cell: 'google.identity', maxClass: 'A', operation: googleOperation('identity.verify'), binding });
  for (const operation of ['drive.read.content', 'gmail.read.message', 'gmail.send', 'calendar.read.events']) {
    assert.throws(
      () => assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: googleOperation(operation), binding }),
      (error) => error.code === 'OMEGA_E_CLASS_CEILING',
      `${operation} was reachable through a recovery state`,
    );
  }
});

test('google/binding: the recovery state is evidenced before it is active, and says it is one', () => {
  const { google } = organ();
  const recoveryKey = createIdentity({ label: 'recovery', kind: 'agent', seed: '77'.repeat(32) });
  const binding = google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: recoveryKey.kid, reason: 'lost the account' });
  const records = google.evidence().filter((entry) => entry.kind === 'OWNER_BINDING');
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, 'ALLOW');
  assert.equal(records[0].detail.method, 'break-glass');
  assert.equal(records[0].detail.recovery, true);
  assert.equal(records[0].detail.reason, 'lost the account');
  assert.equal(records[0].hash, binding.evidence);
});

test('google/binding: a legitimate binding ends the recovery state immediately, not when its clock runs out', () => {
  const { google, owner } = organ();
  const recovery = google.breakGlass({ sub_hash: RECOVERY_HASH, nexa_kid: owner.kid, reason: 'lost the account' });
  assert.equal(google.bindings.hasBreakGlass(), true);
  const legitimate = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  // The recovery state is gone *now*: it is not merely shadowed by the new binding.
  assert.equal(google.bindings.activeFor(recovery.sub_hash), null);
  assert.equal(google.bindings.hasBreakGlass(), false);
  assert.equal(google.bindings.active().sub_hash, legitimate.sub_hash);
  const records = google.evidence().filter((entry) => entry.kind === 'OWNER_BINDING' && entry.decision === 'DENY');
  assert.equal(records.length, 1, 'the termination was not evidenced');
  assert.match(records[0].detail.reason, /legitimate owner binding/);
});

// --- revocation: immediate, evidenced, and in the right order --------------------------

test('google/binding: revocation destroys vault material before it revokes capabilities', () => {
  const vault = fakeVault();
  const { google, owner } = organ({ vault });
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  google.bindings.noteMinted({ sub_hash: binding.sub_hash, capability_id: 'urn:nexa:cap:aaaaaaaaaaaaaa' });
  google.bindings.noteMinted({ sub_hash: binding.sub_hash, capability_id: 'urn:nexa:cap:bbbbbbbbbbbbbb' });
  const result = google.revokeOwner({ sub_hash: binding.sub_hash, reason: 'account compromised' });
  // Order is the whole point: a token that outlives its binding is a defect, not a delay.
  assert.deepEqual(result.steps.map((step) => step.step), ['vault.delete', 'capability.revoke', 'evidence']);
  assert.deepEqual(vault.calls, [binding.sub_hash]);
  assert.equal(result.deleted_material, 2);
  assert.equal(result.capabilities_revoked, 2);
  assert.equal(google.bindings.revocationRecords().length, 2);
  assert.equal(typeof result.evidence, 'string');
});

test('google/binding: revocation is immediate — the binding stops being active at once', () => {
  const { google, owner } = organ();
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  google.revokeOwner({ sub_hash: binding.sub_hash, reason: 'rotating the owner' });
  assert.equal(google.bindings.active(), null);
  assert.equal(google.bindings.activeFor(OWNER_HASH), null);
  const record = google.evidence().find((entry) => entry.kind === 'OWNER_BINDING' && entry.decision === 'DENY');
  assert.equal(record.detail.revoked, true);
  assert.match(record.detail.reason, /rotating the owner/);
  // A revoked subject may bind again — that is what revocation is for — but only on the record.
  const rebound = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  assert.equal(google.bindings.active().sub_hash, rebound.sub_hash);
});

test('google/binding: revocation requires the operator key and a reason', () => {
  const { google, owner, stranger } = organ();
  const binding = google.bindOwner({ sub_hash: OWNER_HASH, nexa_kid: owner.kid });
  assert.throws(
    () => google.bindings.revoke({ sub_hash: binding.sub_hash, reason: 'because', by: stranger.kid }),
    (error) => error.code === 'OMEGA_E_NOT_ACTIVATOR',
  );
  assert.throws(
    () => google.revokeOwner({ sub_hash: binding.sub_hash, reason: '' }),
    (error) => error.code === 'OMEGA_E_SCHEMA',
  );
  assert.equal(google.bindings.active().sub_hash, binding.sub_hash, 'a refused revocation revoked something');
});
