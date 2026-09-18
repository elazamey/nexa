/**
 * GOOGLE IDENTITY CELL v1 — group 3: capability, risk class and approval.
 *
 * The claim under attack here is `D capability ≠ D approval`. A privileged Google operation
 * needs *both*: a capability the authority was willing to mint, and an approval the owner signed
 * for that exact operation. This file tests them separately and together, because the failure
 * mode that matters is the one where either half is treated as sufficient.
 *
 * Two more things are asserted structurally rather than by example: the class of an operation is
 * a function of `(resource, action, scope)` and never of the cell's own opinion, and the subject
 * of a Google capability is the *service cell* — the owner never becomes the holder of the
 * capability they approved.
 *
 * Run alone: `node --test tests/google-capability.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdentity } from '../packages/identity/index.js';
import { Authority } from '../packages/runtime/index.js';
import { mintCapability } from '../packages/capability/index.js';
import {
  APPROVAL_FIELDS,
  GOOGLE_OPERATIONS,
  GOOGLE_SERVICE_CELLS,
  RISK_CLASSES,
  ROLE_CEILINGS,
  admitScope,
  assertWithinCeiling,
  createApprovalStore,
  createGoogleCallPort,
  googleGrantTemplates,
  googleOperation,
  narrowestScope,
  operationDigest,
  scopeRows,
  authorizeGoogleCall,
} from '../packages/cells/google/gateway/index.js';
import { OFFLINE_CLIENT_ID, T0, fixture } from './google-helpers.mjs';

const OWNER_BINDING = `sha256:${'B'.repeat(43)}`;

/** The operator, the service cell, a real authority and a call port. */
function organ() {
  const clock = () => T0;
  const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: '11'.repeat(32) });
  const cell = createIdentity({ label: 'google.gmail', kind: 'service', seed: '55'.repeat(32) });
  const other = createIdentity({ label: 'google.drive', kind: 'service', seed: '66'.repeat(32) });
  const owner = createIdentity({ label: 'nexa.owner', kind: 'agent', seed: '22'.repeat(32) });
  const grants = googleGrantTemplates({ cell: 'google.gmail' });
  const authority = new Authority({ operator, grants, clock, approvals: { 'google.gmail:gmail.send': true } });
  const port = createGoogleCallPort({ operator, clock });
  const records = [];
  const approvals = createApprovalStore({ clock, record: (fields) => { records.push(fields); return { hash: `sha256:${'c'.repeat(43)}`, seq: records.length - 1 }; } });
  const mint = (operation = 'gmail.read.message') => {
    const row = googleOperation(operation);
    return authority.issue({ agent: row.resource === 'net:google.gmail' ? 'google.gmail' : 'google.drive', agentKid: cell.kid, resource: row.resource, action: row.action, args: {} });
  };
  return { clock, operator, owner, cell, other, grants, authority, port, approvals, records, mint };
}

// --- the class is a property of the operation -----------------------------------------

test('google/capability: every operation has a class from the ladder, and the ladder is A–D', () => {
  assert.deepEqual([...RISK_CLASSES], ['A', 'B', 'C', 'D']);
  for (const row of GOOGLE_OPERATIONS) {
    assert.equal(RISK_CLASSES.includes(row.class), true, `${row.operation} has class ${row.class}`);
  }
});

test('google/capability: no operation exists without a documented question and a scope row', () => {
  for (const row of GOOGLE_OPERATIONS) {
    if (row.scope === null) continue;
    const rows = scopeRows(row.scope.cell, row.scope.action);
    assert.equal(rows.length > 0, true, `${row.operation} names ${row.scope.cell}.${row.scope.action}, which has no scope row`);
  }
  // And the reverse: every operation names a cell that has a declared ceiling. An operation on a
  // cell nobody declared is an operation nobody may reach.
  for (const row of GOOGLE_OPERATIONS) {
    const cell = row.scope === null ? 'google.identity' : row.scope.cell;
    assert.equal(typeof GOOGLE_SERVICE_CELLS[cell] !== 'undefined', true, `${row.operation} names ${cell}, which has no declared ceiling`);
  }
});

test('google/capability: gmail.send is class D and a mailbox read is not — the class comes from the operation', () => {
  assert.equal(googleOperation('gmail.send').class, 'D');
  assert.equal(googleOperation('gmail.read.message').class, 'B');
  assert.equal(googleOperation('drive.read.metadata').class, 'A');
  // Being the same resource does not make two operations the same class: send and read both act
  // on `net:google.gmail`, and only one of them can leave the account.
  assert.equal(googleOperation('gmail.send').resource, googleOperation('gmail.read.message').resource);
  assert.notEqual(googleOperation('gmail.send').class, googleOperation('gmail.read.message').class);
});

test('google/capability: the ceiling refuses an operation above it, before anything is minted', () => {
  // A class-D operation asked of a cell whose ceiling is B fails at authorization, and the
  // refusal carries no token: nothing was minted to be revoked afterwards.
  assert.throws(
    () => assertWithinCeiling({ cell: 'google.drive', maxClass: 'B', operation: googleOperation('gmail.send') }),
    (error) => error.code === 'OMEGA_E_CLASS_CEILING' && error.details.class === 'D',
  );
  // The same operation at a cell whose ceiling allows it is not refused by the ceiling.
  assert.equal(assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: googleOperation('gmail.send') }).operation, 'gmail.send');
});

test('google/capability: roles inform the ceiling and never raise it', () => {
  assert.equal(ROLE_CEILINGS.owner, 'D');
  assert.equal(ROLE_CEILINGS.developer, 'C');
  assert.equal(ROLE_CEILINGS.viewer, 'A');
  const developer = { role: 'developer', method: 'invitation' };
  assert.throws(
    () => assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: googleOperation('gmail.send'), binding: developer }),
    (error) => error.code === 'OMEGA_E_CLASS_CEILING',
  );
  const viewer = { role: 'viewer', method: 'invitation' };
  assert.throws(
    () => assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: googleOperation('gmail.read.message'), binding: viewer }),
    (error) => error.code === 'OMEGA_E_CLASS_CEILING',
  );
  const unknown = { role: 'superuser', method: 'invitation' };
  assert.throws(
    () => assertWithinCeiling({ cell: 'google.gmail', maxClass: 'D', operation: googleOperation('gmail.read.message'), binding: unknown }),
    (error) => error.code === 'OMEGA_E_CLASS_CEILING',
  );
});

// --- the authority still decides ------------------------------------------------------

test('google/capability: a class-D operation cannot be minted without an approval — by the authority itself', () => {
  const clock = () => T0;
  const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: '11'.repeat(32) });
  const cell = createIdentity({ label: 'google.gmail', kind: 'service', seed: '55'.repeat(32) });
  // The same grants, with no approval declared for `gmail.send`: the authority refuses to mint.
  const authority = new Authority({ operator, grants: googleGrantTemplates({ cell: 'google.gmail' }), clock });
  assert.throws(
    () => authority.issue({ agent: 'google.gmail', agentKid: cell.kid, resource: 'net:google.gmail', action: 'send', args: {} }),
    (error) => error.code === 'OMEGA_E_APPROVAL_REQUIRED',
  );
  // A read needs no approval, and mints: the refusal was about the operation, not the cell.
  const read = authority.issue({ agent: 'google.gmail', agentKid: cell.kid, resource: 'net:google.gmail', action: 'read', args: {} });
  assert.equal(typeof read.token.id, 'string');
});

test('google/capability: the capability subject is the service cell, never the owner', () => {
  const { mint, cell, operator, owner } = organ();
  const { token } = mint('gmail.send');
  assert.equal(token.subject, cell.kid);
  assert.notEqual(token.subject, operator.kid);
  assert.notEqual(token.subject, owner.kid);
  assert.equal(token.resource, 'net:google.gmail');
  assert.deepEqual(token.actions, ['send']);
  // The owner appears nowhere in the token: identity is not authority, and authority is not
  // identity. A capability is held by the cell that will make the call.
  assert.equal(JSON.stringify(token).includes(owner.kid), false);
});

test('google/capability: a capability presented by another cell is refused with the audience code', () => {
  const { mint, port, cell, other } = organ();
  const { token } = mint('gmail.read.message');
  const refused = port.verify(token, { presenter: other.kid, resource: 'net:google.gmail', action: 'read', at: T0 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'NEXA_E_CAP_AUDIENCE');
  // The legitimate presenter is accepted, and only once.
  assert.equal(port.verify(token, { presenter: cell.kid, resource: 'net:google.gmail', action: 'read', at: T0 }).ok, true);
  const replay = port.verify(token, { presenter: cell.kid, resource: 'net:google.gmail', action: 'read', at: T0 });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'NEXA_E_REPLAY');
});

test('google/capability: a call port refuses a capability minted by someone else', () => {
  const { port, cell } = organ();
  const stranger = createIdentity({ label: 'stranger', kind: 'agent', seed: '77'.repeat(32) });
  const foreign = mintCapability({
    issuer: stranger,
    subject: cell.kid,
    presenter: cell.kid,
    resource: 'net:google.gmail',
    actions: ['read'],
    ttlMs: 300_000,
    now: T0,
  });
  const refused = port.verify(foreign, { presenter: cell.kid, resource: 'net:google.gmail', action: 'read', at: T0 });
  assert.equal(refused.ok, false);
  // An untrusted issuer is not a capability: a structurally perfect token from a key the
  // authority does not trust is refused with the code that says exactly that.
  assert.equal(refused.code, 'NEXA_E_UNTRUSTED');
});

// --- approvals: single-use, exact, and in evidence -------------------------------------

test('google/capability: an approval carries the ten binding fields, unconsumed and single-use', () => {
  const { approvals, operator } = organ();
  const approval = approvals.grant({ operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', owner_binding: OWNER_BINDING, signer: operator.kid });
  for (const field of APPROVAL_FIELDS) {
    assert.equal(Object.hasOwn(approval, field), true, `an approval has no ${field}`);
  }
  assert.equal(approval.single_use, true);
  assert.equal(approval.consumed_at, null);
  assert.equal(approval.owner_binding, OWNER_BINDING);
  assert.equal(approval.operation_digest, operationDigest({ resource: 'net:google.gmail', action: 'send', scope: null }));
  assert.equal(typeof approval.evidence, 'string');
});

test('google/capability: approval for X is not approval for another X', () => {
  const { approvals, operator } = organ();
  const approval = approvals.grant({ operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', owner_binding: OWNER_BINDING, signer: operator.kid });
  for (const other of [
    { resource: 'net:google.drive', action: 'read', scope: null },
    { resource: 'net:google.gmail', action: 'read', scope: null },
    { resource: 'net:google.gmail', action: 'send', scope: 'https://www.googleapis.com/auth/gmail.send' },
  ]) {
    assert.throws(
      () => approvals.consume({ approval_id: approval.approval_id, ...other }),
      (error) => error.code === 'OMEGA_E_APPROVAL_REQUIRED' && error.details.approved !== error.details.requested,
      `${other.action} on ${other.resource} was consumed under an approval for send`,
    );
  }
  // The exact operation still consumes.
  assert.equal(approvals.consume({ approval_id: approval.approval_id, resource: 'net:google.gmail', action: 'send' }).approval_id, approval.approval_id);
});

test('google/capability: an approval is single-use — a replay is named as a replay', () => {
  const { approvals, operator, records } = organ();
  const approval = approvals.grant({ operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', owner_binding: OWNER_BINDING, signer: operator.kid });
  approvals.consume({ approval_id: approval.approval_id, resource: 'net:google.gmail', action: 'send' });
  assert.throws(
    () => approvals.consume({ approval_id: approval.approval_id, resource: 'net:google.gmail', action: 'send' }),
    (error) => error.code === 'OMEGA_E_APPROVAL_CONSUMED',
  );
  // Two records: one grant, one consumption. The approval is evidenced on both ends.
  assert.deepEqual(records.map((record) => record.kind), ['APPROVAL', 'APPROVAL']);
  assert.equal(records[1].detail.consumed, true);
});

test('google/capability: one exact operation has one live approval', () => {
  const { approvals, operator } = organ();
  const args = { operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', owner_binding: OWNER_BINDING, signer: operator.kid };
  const first = approvals.grant(args);
  assert.throws(() => approvals.grant(args), (error) => error.code === 'OMEGA_E_DUPLICATE');
  approvals.consume({ approval_id: first.approval_id, resource: 'net:google.gmail', action: 'send' });
  // After the operation it authorized is done, the owner may approve another one — and it is a
  // different approval, not a resurrection of the first.
  const second = approvals.grant(args);
  assert.notEqual(second.approval_id, first.approval_id);
});

// --- the gate: capability and approval, both ------------------------------------------

test('google/capability: the gate passes a capability refusal through without rewriting its code', () => {
  const { mint, port, cell, other } = organ();
  const { token } = mint('gmail.read.message');
  // The wrong presenter is refused by the capability layer with its own code, and the gate must
  // neither swallow it nor flatten it into an Ω code: a caller has to be able to tell "you are
  // not the holder" from "you hold nothing".
  assert.throws(
    () => authorizeGoogleCall({
      operation: 'gmail.read.message',
      cell: 'google.gmail',
      maxClass: 'D',
      capability: token,
      presenter: other.kid,
      verify: (candidate, input) => port.verify(candidate, input),
      clock: () => T0,
    }),
    (error) => error.code === 'NEXA_E_CAP_AUDIENCE',
  );
  // The same call by the legitimate presenter succeeds, so the refusal above was about the holder.
  assert.equal(authorizeGoogleCall({
    operation: 'gmail.read.message',
    cell: 'google.gmail',
    maxClass: 'D',
    capability: token,
    presenter: cell.kid,
    verify: (candidate, input) => port.verify(candidate, input),
    clock: () => T0,
  }).ok, true);
});

test('google/capability: a class-D call without an approval is refused, even with a valid capability', () => {
  const { mint, approvals, port, cell } = organ();
  const { token } = mint('gmail.send');
  assert.throws(
    () => authorizeGoogleCall({
      operation: 'gmail.send',
      cell: 'google.gmail',
      maxClass: 'D',
      capability: token,
      presenter: cell.kid,
      verify: (candidate, input) => port.verify(candidate, input),
      clock: () => T0,
      approvals,
      approval_id: null,
    }),
    (error) => error.code === 'OMEGA_E_APPROVAL_REQUIRED',
  );
});

test('google/capability: a class-D call with both halves is authorized, and both are recorded', () => {
  const { mint, approvals, port, cell, operator, records } = organ();
  const { token } = mint('gmail.send');
  const approval = approvals.grant({ operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', owner_binding: OWNER_BINDING, signer: operator.kid });
  const decision = authorizeGoogleCall({
    operation: 'gmail.send',
    cell: 'google.gmail',
    maxClass: 'D',
    capability: token,
    presenter: cell.kid,
    verify: (candidate, input) => port.verify(candidate, input),
    clock: () => T0,
    approvals,
    approval_id: approval.approval_id,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.operation.class, 'D');
  assert.equal(decision.approval.consumed_at, '2026-09-18T12:00:00Z');
  assert.equal(records.filter((record) => record.kind === 'APPROVAL').length, 2);
  // The capability was spent once, and the port says so.
  assert.equal(port.spent(token.id), true);
});

test('google/capability: a class-A call needs no approval, and a scope it may not request is refused', () => {
  const { cell } = organ();
  const call = authorizeGoogleCall({
    operation: 'identity.verify',
    cell: 'google.identity',
    maxClass: 'A',
    capability: mintCapability({
      issuer: createIdentity({ label: 'op', kind: 'agent', seed: '11'.repeat(32) }),
      subject: createIdentity({ label: 'google.identity', kind: 'service', seed: '88'.repeat(32) }).kid,
      presenter: cell.kid,
      resource: 'cell:google.identity',
      actions: ['verify'],
      ttlMs: 300_000,
      now: T0,
    }),
    presenter: cell.kid,
    verify: () => ({ ok: true }),
    clock: () => T0,
  });
  assert.equal(call.ok, true);
  assert.equal(call.approval, null);
  // The identity path has no OAuth scope, so a scope offered with it is not admitted — there is
  // no row for it to be matched against.
  assert.throws(
    () => authorizeGoogleCall({
      operation: 'identity.verify',
      cell: 'google.identity',
      maxClass: 'A',
      capability: {},
      presenter: cell.kid,
      verify: () => ({ ok: true }),
      clock: () => T0,
      scope: 'openid',
    }),
    (error) => error.code === 'OMEGA_E_SCOPE',
  );
});

// --- scopes: no cell, no action, no documented question → no scope ---------------------

test('google/capability: scope admission enforces the three rules', () => {
  // No cell → no scope.
  assert.throws(() => admitScope({ cell: 'google.maps', action: 'read', scope: 'openid' }), (error) => error.code === 'OMEGA_E_SCOPE');
  // No action → no scope.
  assert.throws(() => admitScope({ cell: 'google.identity', action: 'mint', scope: 'openid' }), (error) => error.code === 'OMEGA_E_SCOPE');
  // No documented question → no scope: the scope is real and belongs to another cell.
  assert.throws(() => admitScope({ cell: 'google.sheets', action: 'read.range', scope: 'openid' }), (error) => error.code === 'OMEGA_E_SCOPE');
});

test('google/capability: a scope from a later phase is refused until that phase is open', () => {
  const driveFile = 'https://www.googleapis.com/auth/drive.file';
  assert.throws(
    () => admitScope({ cell: 'google.drive', action: 'read.metadata', scope: driveFile, phase: 'G0' }),
    (error) => error.code === 'OMEGA_E_SCOPE' && error.details.row_phase === 'G2',
  );
  // G0 admits exactly the three identity rows — which is why G0 holds no refresh token.
  const g0 = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
  for (const scope of g0) {
    assert.equal(admitScope({ cell: 'google.identity', action: 'verify', scope, phase: 'G0' }).v1_required, true);
  }
});

test('google/capability: the narrowest rung wins — a per-file scope is chosen over the whole account', () => {
  const narrow = narrowestScope({ cell: 'google.drive', action: 'read.metadata', phase: 'G2' });
  assert.equal(narrow.full_scope_uri, 'https://www.googleapis.com/auth/drive.file');
  assert.equal(narrow.rung, 1);
  assert.equal(narrow.google_classification, 'non-sensitive');
  // Every documented question has a narrowest rung, and every rung after the first is wider.
  for (const [cell, action] of [['google.drive', 'read.content'], ['google.gmail', 'read.message'], ['google.calendar', 'read.events']]) {
    const rows = scopeRows(cell, action);
    assert.equal(rows[0].rung, 1, `${cell}.${action} has no first rung`);
    assert.equal(rows.every((row, index) => index === 0 || row.rung > rows[index - 1].rung), true, `${cell}.${action} rungs are out of order`);
  }
});

test('google/capability: a scope and a Google classification are orthogonal facts, and both are recorded', () => {
  // Google calls `gmail.send` sensitive; NEXA calls it class D. Neither number is derived from
  // the other, and the table keeps both so that a change on Google's side is visible.
  const row = scopeRows('google.gmail', 'send')[0];
  assert.equal(row.google_classification, 'sensitive');
  assert.equal(row.approval_class, 'D');
  const read = scopeRows('google.gmail', 'read.message')[0];
  assert.equal(read.google_classification, 'restricted');
  assert.equal(read.approval_class, 'B');
});

test('google/capability: the grant templates name the service cell and the exact action', () => {
  const grants = googleGrantTemplates({ cell: 'google.gmail' });
  assert.equal(grants.length > 0, true);
  for (const grant of grants) {
    assert.equal(grant.subject, 'google.gmail');
    assert.equal(grant.actions.length, 1);
    assert.equal(grant.resource, 'net:google.gmail');
    assert.equal(grant.requiresApproval, grant.class === 'D');
  }
  assert.equal(grants.find((grant) => grant.operation === 'gmail.send').requiresApproval, true);
  assert.equal(grants.find((grant) => grant.operation === 'gmail.read.message').requiresApproval, false);
  // An unknown operation name matches no row, so it produces no template — and asking the table
  // itself is a refusal, so the host learns the name is wrong rather than getting an empty grant.
  assert.deepEqual(googleGrantTemplates({ cell: 'google.gmail', operations: ['gmail.delete'] }), []);
  assert.throws(() => googleOperation('gmail.delete'), (error) => error.code === 'OMEGA_E_SCHEMA');
});

test('google/capability: the identity cell holds no authority of its own — the gateway verifies, the host mints', () => {
  // The gateway never imports the authority: the verification port is passed in, and a call that
  // presents nothing is refused rather than minted for.
  const organValue = organ();
  assert.throws(
    () => authorizeGoogleCall({
      operation: 'gmail.read.message',
      cell: 'google.gmail',
      maxClass: 'D',
      capability: null,
      presenter: organValue.cell.kid,
      verify: (candidate, input) => organValue.port.verify(candidate, input),
      clock: () => T0,
    }),
    (error) => error.code === 'OMEGA_E_CAP_MISSING',
  );
  // And the login path has no capability at all: the identity cell's own receptor is authorized
  // by the tissue's guarantor, not by a token the cell could keep.
  const google = fixture().google;
  const challenge = google.begin();
  assert.equal(typeof challenge, 'string');
  assert.equal(OFFLINE_CLIENT_ID.endsWith('apps.googleusercontent.com'), true);
});
