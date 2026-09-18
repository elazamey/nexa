/**
 * GOOGLE IDENTITY CELL v1 — group 6: the closure invariants (GI-1 … GI-7).
 *
 * G0 is closed on the strength of a record (`spec/google/closure-g0.md`), and a record whose
 * invariants live only in prose is a promise. This file is where the invariants the gate fixes
 * (identity-cell.md, "Invariants this phase fixes") are held to the code: one test per
 * invariant, each asserting the positive form of the rule and the refusal that keeps it.
 * The other Google suites attack the machinery; this one holds the contract closed.
 *
 * Run alone: `node --test tests/google-invariants.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createIdentity } from '../packages/identity/index.js';
import { Authority } from '../packages/runtime/index.js';
import { sha256Multihash } from '../packages/crypto/index.js';
import { BREAK_GLASS_MAX_MS, SUBJECT_DOMAIN, subHash } from '../packages/cells/google/identity/index.js';
import {
  GOOGLE_SERVICE_CELLS,
  assertWithinCeiling,
  authorizeGoogleCall,
  createApprovalStore,
  createGoogleCallPort,
  googleGrantTemplates,
  googleOperation,
} from '../packages/cells/google/gateway/index.js';
import { SUBJECTS, T0, everythingWritten, fixture } from './google-helpers.mjs';

/** A synthetic owner binding id for the approval records: approvals name their author. */
const OWNER_BINDING = `sha256:${'B'.repeat(43)}`;

/** One login across the membrane, with a fresh challenge and a token that carries it. */
function login(fix, overrides = {}) {
  const { google, tokenFor } = fix;
  const nonce = google.begin();
  return google.login({ token: tokenFor({ nonce, ...overrides }), nonce });
}

/** The operator, the gmail service cell, and a NEXA authority willing to mint for it. */
function organ({ approvalsForD = true } = {}) {
  const clock = () => T0;
  const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: '11'.repeat(32) });
  const cell = createIdentity({ label: 'google.gmail', kind: 'service', seed: '55'.repeat(32) });
  const owner = createIdentity({ label: 'nexa.owner', kind: 'agent', seed: '22'.repeat(32) });
  const authority = new Authority({
    operator,
    grants: googleGrantTemplates({ cell: 'google.gmail' }),
    clock,
    ...(approvalsForD ? { approvals: { 'google.gmail:gmail.send': true } } : {}),
  });
  return { clock, operator, cell, owner, authority };
}

test('google/invariants GI-1: Google proves identity, NEXA decides authority — a verified principal carries no capability, and the gate refuses without one', () => {
  const fix = fixture();
  const verdict = login(fix);
  assert.equal(verdict.ok, true);
  const principal = verdict.principal;
  // What crosses the membrane is a principal: no capability, no role, no token, no authority.
  for (const key of ['capability', 'role', 'token', 'authority']) {
    assert.equal(key in principal, false, `a principal carries ${key}`);
  }
  // Identity alone does not pass the gate: with no capability, the call is refused — and the
  // refusal is NEXA's code, not Google's.
  const { operator, cell } = organ();
  const port = createGoogleCallPort({ operator, clock: () => T0 });
  const refused = port.verify(null, { presenter: cell.kid, resource: 'net:google.gmail', action: 'read', at: T0 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'OMEGA_E_CAP_MISSING');
  // And authority comes from one place only: NEXA's minting authority — which may itself refuse,
  // whatever Google has just proven about the caller.
  const authority = new Authority({ operator, grants: googleGrantTemplates({ cell: 'google.gmail' }), clock: () => T0 });
  assert.throws(
    () => authority.issue({ agent: 'google.gmail', agentKid: cell.kid, resource: 'net:google.gmail', action: 'send', args: {} }),
    (error) => error.code === 'OMEGA_E_APPROVAL_REQUIRED',
  );
});

test('google/invariants GI-2: sub is the identity anchor and email is display metadata — a changed email changes nothing', () => {
  const fix = fixture();
  const { google, owner } = fix;
  const first = login(fix);
  const second = login(fix, { email: 'renamed+alias@gmail.com', email_verified: true });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.principal.sub_hash, first.principal.sub_hash, 'a changed email changed the identity');
  assert.notEqual(second.principal.email_display, first.principal.email_display);
  // An unverified email is not displayed at all, and does not stop the subject being verified.
  const third = login(fix, { email: 'not-proven@gmail.com', email_verified: false });
  assert.equal(third.ok, true);
  assert.equal(third.principal.email_display, null);
  // And the binding is keyed on the digest: one anchor, every email.
  const anchor = subHash(SUBJECTS.owner);
  assert.equal(first.principal.sub_hash, anchor);
  google.bindOwner({ sub_hash: anchor, nexa_kid: owner.kid });
  assert.equal(google.bindings.activeFor(anchor).sub_hash, anchor);
});

test('google/invariants GI-3: stored identity = sha256("NEXA/google1 subject\\0" || sub) — recomputable, pinned, and the raw sub never appears', () => {
  assert.equal(SUBJECT_DOMAIN, 'NEXA/google1 subject\u0000');
  const fix = fixture();
  const verdict = login(fix);
  assert.equal(verdict.ok, true);
  // Domain separation is load-bearing: the stored value is the digest under the domain prefix,
  // recomputable by an auditor, and nothing else.
  const expected = sha256Multihash(Buffer.concat([Buffer.from(SUBJECT_DOMAIN, 'utf8'), Buffer.from(SUBJECTS.owner, 'utf8')]));
  assert.equal(verdict.principal.sub_hash, expected);
  assert.notEqual(verdict.principal.sub_hash, sha256Multihash(Buffer.from(SUBJECTS.owner, 'utf8')));
  // The pinned vector carries the same invariant, so record, vector and code must agree.
  const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/google.json', import.meta.url), 'utf8'));
  assert.equal(vectors.invariants.identity_anchor, 'sub');
  assert.equal(vectors.invariants.stored_identity, 'sha256("NEXA/google1 subject\u0000" || sub)');
  // And the raw subject is nowhere in what the organ wrote — ledger, evidence or crossings.
  const written = everythingWritten(fix.google, fix.ledger);
  assert.equal(written.includes(SUBJECTS.owner), false, 'the raw sub is in the record');
});

test('google/invariants GI-4: owner identity ≠ capability subject — and a login never creates a binding', () => {
  const fix = fixture();
  const { owner } = fix;
  const verdict = login(fix);
  assert.equal(verdict.ok, true);
  assert.equal(fix.google.bindings.active(), null, 'a login created a binding');
  // The only thing a login produces is a principal. The capability, when the authority mints
  // one, is held by the service cell — and the owner appears nowhere in it.
  const { cell, authority } = organ();
  const issued = authority.issue({ agent: 'google.gmail', agentKid: cell.kid, resource: 'net:google.gmail', action: 'send', args: {} });
  assert.equal(issued.token.subject, cell.kid);
  assert.notEqual(issued.token.subject, owner.kid);
  assert.equal(JSON.stringify(issued.token).includes(owner.kid), false, 'the owner appears in the capability');
});

test('google/invariants GI-5: the class is a property of the triple, and max_class is a kernel invariant — above the ceiling, authorization fails and nothing is minted', () => {
  const row = googleOperation('gmail.send');
  assert.deepEqual([row.resource, row.action], ['net:google.gmail', 'send']);
  assert.equal(row.class, 'D');
  // The same resource can hold two classes: read and send both act on net:google.gmail, and the
  // class follows the operation, never the cell that declares it.
  assert.equal(googleOperation('gmail.read.message').resource, row.resource);
  assert.notEqual(googleOperation('gmail.read.message').class, row.class);
  // The ceiling is declared with the cell's nucleus and is frozen: it is not editable at run
  // time, and the nucleus says what the class-D row means.
  const gmail = GOOGLE_SERVICE_CELLS['google.gmail'];
  assert.equal(Object.isFrozen(gmail), true);
  assert.equal(gmail.max_class, 'D');
  assert.equal(gmail.nucleus.invariants.includes('sending is class D: capability, policy and approval, every time'), true);
  // And an operation above the ceiling is refused at authorization — before any mint, with no
  // token to be revoked afterwards.
  assert.throws(
    () => assertWithinCeiling({ cell: 'google.drive', maxClass: 'B', operation: row }),
    (error) => error.code === 'OMEGA_E_CLASS_CEILING' && error.details.class === 'D',
  );
  assert.equal(assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: row }).operation, 'gmail.send');
});

test('google/invariants GI-6: class D is the whole stack — capability, policy, owner approval, evidence before write, approval consumed with the call', () => {
  const { operator, cell, authority } = organ();
  const port = createGoogleCallPort({ operator, clock: () => T0 });
  const records = [];
  const approvals = createApprovalStore({
    clock: () => T0,
    record: (fields) => {
      records.push(fields);
      return { hash: `sha256:${'c'.repeat(43)}`, seq: records.length - 1 };
    },
  });
  const row = googleOperation('gmail.send');
  const call = (approval_id = null) => authorizeGoogleCall({
    operation: 'gmail.send',
    cell: 'google.gmail',
    maxClass: 'D',
    capability: authority.issue({ agent: 'google.gmail', agentKid: cell.kid, resource: row.resource, action: row.action, args: {} }).token,
    presenter: cell.kid,
    verify: (candidate, input) => port.verify(candidate, input),
    clock: () => T0,
    approvals,
    approval_id,
  });
  // Capability + policy alone is not enough: the gate names the missing approval.
  assert.throws(() => call(null), (error) => error.code === 'OMEGA_E_APPROVAL_REQUIRED');
  // An approval for another operation is not an approval: the digest does not match, and the
  // refusal says which half of the pair it was.
  const wrong = approvals.grant({ operation: 'gmail.read.message', resource: 'net:google.gmail', action: 'read', owner_binding: OWNER_BINDING, signer: operator.kid });
  assert.throws(
    () => call(wrong.approval_id),
    (error) => error.code === 'OMEGA_E_APPROVAL_REQUIRED' && error.details.approved !== error.details.requested,
  );
  // The right approval is in evidence before it authorizes anything — no write before evidence.
  const right = approvals.grant({ operation: 'gmail.send', resource: row.resource, action: row.action, owner_binding: OWNER_BINDING, signer: operator.kid });
  assert.equal(records[records.length - 1].kind, 'APPROVAL');
  assert.equal(typeof right.evidence, 'string');
  const decision = call(right.approval_id);
  assert.equal(decision.ok, true);
  assert.equal(decision.approval.consumed_at, '2026-09-18T12:00:00Z');
  // And the approval is consumed with the call: a replay is named as a replay.
  assert.throws(
    () => approvals.consume({ approval_id: right.approval_id, resource: row.resource, action: row.action }),
    (error) => error.code === 'OMEGA_E_APPROVAL_CONSUMED',
  );
});

test('google/invariants GI-7: break-glass is a time-bounded recovery state and never Authority', () => {
  const { google, owner } = fixture();
  const recoveryHash = subHash(SUBJECTS.attacker);
  // Bounded: the 24-hour bound is enforced, and an hour longer is unbounded.
  assert.throws(
    () => google.breakGlass({ sub_hash: recoveryHash, nexa_kid: owner.kid, reason: 'lost account', hours: 25 }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_UNBOUNDED',
  );
  const recovery = google.breakGlass({ sub_hash: recoveryHash, nexa_kid: owner.kid, reason: 'lost account', hours: 24 });
  assert.equal(recovery.method, 'break-glass');
  assert.equal(recovery.role, 'recovery');
  assert.ok(new Date(recovery.expires_at).getTime() - new Date(recovery.created_at).getTime() <= BREAK_GLASS_MAX_MS);
  // Never a second recovery state: a chain is refused.
  assert.throws(
    () => google.breakGlass({ sub_hash: subHash(SUBJECTS.other), nexa_kid: owner.kid, reason: 'again', hours: 1 }),
    (error) => error.code === 'OMEGA_E_BREAKGLASS_CHAIN',
  );
  // Never Authority: class D is unreachable under the recovery state, and identity verification
  // is all it may reach.
  assert.throws(
    () => assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: googleOperation('gmail.send'), binding: recovery }),
    (error) => error.code === 'OMEGA_E_CLASS_CEILING' && error.details.recovery_operations.join(',') === 'identity.verify',
  );
  assert.equal(
    assertWithinCeiling({ cell: 'google.identity', maxClass: 'A', operation: googleOperation('identity.verify'), binding: recovery }).operation,
    'identity.verify',
  );
  // And the moment a legitimate binding exists, the recovery state is over — not when its
  // clock runs out — with the revocation in evidence.
  google.bindOwner({ sub_hash: subHash(SUBJECTS.owner), nexa_kid: owner.kid });
  assert.equal(google.bindings.hasBreakGlass(), false);
  const revoked = google.bindings.history().find((entry) => entry.sub_hash === recoveryHash && entry.revocation_reason);
  assert.equal(revoked !== undefined, true, 'the recovery state was not recorded as revoked');
  assert.equal(google.bindings.active().method, 'invitation');
});
