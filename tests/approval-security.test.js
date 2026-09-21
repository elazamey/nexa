/**
 * v13-1 — Approval Protocol security vectors (test-first).
 *
 * Written BEFORE `packages/policy/src/approval.js` exists — repo culture:
 * vectors before implementation. The approval protocol is the human seat in
 * the loop (v13 map §2A, doc §10/§11/§33/§46): it is the ONLY channel that
 * can authorize execution behind the FILESYSTEM_WRITE / REAL_EXECUTION /
 * TERMINAL gates — and it can never touch the policy root. The policy root
 * (root policy, gates, keys, verifier, rollback) stays IMMUTABLE /
 * HUMAN-GOVERNED: no approval, however many, however trusted, can open the
 * AUTO_DEPLOY / AUTO_PUSH / AUTO_COMMIT gates or act on policy resources.
 *
 * Deterministic: fixed clock, fixed seeds, no network, no filesystem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity } from '../packages/identity/index.js';
import { ApprovalLedger, isApprovalEligible } from '../packages/policy/index.js';
import { SEEDS, T0, throwsCode } from './helpers.mjs';

function approvalWorld() {
  let current = T0;
  const operator = createIdentity({ label: 'approver-operator', seed: SEEDS.operator });
  const outsider = createIdentity({ label: 'approver-outsider', seed: SEEDS.outsider });
  const ledger = new ApprovalLedger({
    trustedApprovers: [operator.kid],
    now: () => current,
  });
  const advance = (seconds) => {
    current = new Date(current.getTime() + seconds * 1000);
  };
  return { ledger, operator, outsider, advance, clock: () => current };
}

const FS_REQUEST = {
  resource: 'fs:workspace',
  action: 'write',
  target: 'src/**',
  missionId: 'm-001',
};

// ---------------------------------------------------------------------------
// V0. Success path — request → approve(once) → consume, chain verifies
// ---------------------------------------------------------------------------
test('V0: a gated write is requested, approved once, consumed — and the chain verifies', () => {
  const { ledger, operator } = approvalWorld();

  const request = ledger.request(FS_REQUEST);
  assert.equal(request.decision, 'REQUESTED');
  assert.equal(request.gate, 'FILESYSTEM_WRITE');
  assert.ok(request.approvalId.length > 0, 'approval id issued');

  const grant = ledger.approve({
    approvalId: request.approvalId,
    scope: 'once',
    approverKid: operator.kid,
  });
  assert.equal(grant.decision, 'APPROVED_ONCE');

  const used = ledger.consume({
    approvalId: request.approvalId,
    resource: FS_REQUEST.resource,
    action: FS_REQUEST.action,
    target: FS_REQUEST.target,
    missionId: FS_REQUEST.missionId,
  });
  assert.equal(used.decision, 'CONSUMED');

  const chain = ledger.verifyChain();
  assert.equal(chain.ok, true);
  assert.equal(chain.length, 3, 'request + grant + consume, each a chained record');
  assert.deepEqual(
    ledger.events().map((event) => event.kind),
    ['APPROVAL_REQUEST', 'APPROVAL_GRANTED', 'APPROVAL_CONSUMED'],
  );
});

// ---------------------------------------------------------------------------
// V1. A once-approval is consumed exactly once
// ---------------------------------------------------------------------------
test('V1: a once-approval cannot be consumed a second time', () => {
  const { ledger, operator } = approvalWorld();
  const request = ledger.request(FS_REQUEST);
  ledger.approve({ approvalId: request.approvalId, scope: 'once', approverKid: operator.kid });

  const args = {
    approvalId: request.approvalId,
    resource: FS_REQUEST.resource,
    action: FS_REQUEST.action,
    target: FS_REQUEST.target,
    missionId: FS_REQUEST.missionId,
  };
  assert.equal(ledger.consume(args).decision, 'CONSUMED');
  throwsCode(assert, () => ledger.consume(args), 'NEXA_E_APPROVAL_USED');
});

// ---------------------------------------------------------------------------
// V2. The approval binds the exact (resource, action, target) tuple
// ---------------------------------------------------------------------------
test('V2: the approved target and the granted action are both enforced at consume time', () => {
  const { ledger, operator } = approvalWorld();
  const request = ledger.request(FS_REQUEST);
  ledger.approve({ approvalId: request.approvalId, scope: 'once', approverKid: operator.kid });

  // Different target class — refused.
  throwsCode(
    assert,
    () =>
      ledger.consume({
        approvalId: request.approvalId,
        resource: FS_REQUEST.resource,
        action: FS_REQUEST.action,
        target: 'secrets/**',
        missionId: FS_REQUEST.missionId,
      }),
    'NEXA_E_APPROVAL_TARGET',
  );
  // Different action on the same resource — outside the grant.
  throwsCode(
    assert,
    () =>
      ledger.consume({
        approvalId: request.approvalId,
        resource: FS_REQUEST.resource,
        action: 'delete',
        target: FS_REQUEST.target,
        missionId: FS_REQUEST.missionId,
      }),
    'NEXA_E_APPROVAL_SCOPE',
  );
  // The exact tuple still works — nothing was consumed by the refusals.
  assert.equal(
    ledger.consume({
      approvalId: request.approvalId,
      resource: FS_REQUEST.resource,
      action: FS_REQUEST.action,
      target: FS_REQUEST.target,
      missionId: FS_REQUEST.missionId,
    }).decision,
    'CONSUMED',
  );
});

// ---------------------------------------------------------------------------
// V3. Expired approvals are dead — at approve time and at consume time
// ---------------------------------------------------------------------------
test('V3: expired approval requests cannot be approved; expired grants cannot be consumed', () => {
  const { ledger, operator, advance } = approvalWorld();

  // Request expires before the human ever acts.
  const stale = ledger.request({ ...FS_REQUEST, ttlSeconds: 60 });
  advance(120);
  throwsCode(
    assert,
    () => ledger.approve({ approvalId: stale.approvalId, scope: 'once', approverKid: operator.kid }),
    'NEXA_E_APPROVAL_EXPIRED',
  );

  // Grant is made, then the execution window lapses.
  advance(300);
  const late = ledger.request({ ...FS_REQUEST, ttlSeconds: 120 });
  ledger.approve({ approvalId: late.approvalId, scope: 'once', approverKid: operator.kid });
  advance(300);
  throwsCode(
    assert,
    () =>
      ledger.consume({
        approvalId: late.approvalId,
        resource: FS_REQUEST.resource,
        action: FS_REQUEST.action,
        target: FS_REQUEST.target,
        missionId: FS_REQUEST.missionId,
      }),
    'NEXA_E_APPROVAL_EXPIRED',
  );
});

// ---------------------------------------------------------------------------
// V4. Approvals can never touch the policy root
// ---------------------------------------------------------------------------
test('V4: policy-root resources are not approvable — at request time and at consume time', () => {
  const { ledger, operator } = approvalWorld();

  // No approval request may ever be opened against a root resource.
  throwsCode(
    assert,
    () => ledger.request({ resource: 'policy:root', action: 'modify', target: 'gates' }),
    'NEXA_E_POLICY_IMMUTABLE',
  );

  // A valid fs grant cannot be spent on a root resource.
  const request = ledger.request(FS_REQUEST);
  ledger.approve({ approvalId: request.approvalId, scope: 'once', approverKid: operator.kid });
  throwsCode(
    assert,
    () =>
      ledger.consume({
        approvalId: request.approvalId,
        resource: 'policy:root',
        action: 'modify',
        target: 'gates',
        missionId: FS_REQUEST.missionId,
      }),
    'NEXA_E_POLICY_IMMUTABLE',
  );
});

// ---------------------------------------------------------------------------
// V5. Release gates are root-governed — publish/deploy/push are NOT unlockable
// ---------------------------------------------------------------------------
test('V5: AUTO_DEPLOY / AUTO_PUSH gates refuse the approval channel entirely', () => {
  const { ledger } = approvalWorld();

  // Publish (v12 creative phase 6 boundary — deliberate gate decision only).
  assert.deepEqual(isApprovalEligible({ resource: 'tool:creative.publish', action: 'publish' }), {
    eligible: false,
    gate: 'AUTO_DEPLOY',
    reason: 'gate is root-governed',
  });
  throwsCode(
    assert,
    () => ledger.request({ resource: 'tool:creative.publish', action: 'publish', target: 'campaign' }),
    'NEXA_E_POLICY_IMMUTABLE',
  );
  // Git push — same class of root decision (action-level gate: 'push' → AUTO_PUSH).
  assert.equal(isApprovalEligible({ resource: 'tool:git', action: 'push' }).gate, 'AUTO_PUSH');
  throwsCode(
    assert,
    () => ledger.request({ resource: 'tool:git', action: 'push', target: 'main' }),
    'NEXA_E_POLICY_IMMUTABLE',
  );
  // Ungated resources need no approval at all.
  assert.deepEqual(isApprovalEligible({ resource: 'tool:echo', action: 'call' }), {
    eligible: false,
    gate: null,
    reason: 'not gated',
  });
});

// ---------------------------------------------------------------------------
// V6. The approval log is a tamper-evident hash chain
// ---------------------------------------------------------------------------
test('V6: tampering with any approval record breaks verification at import time', () => {
  const { ledger, operator, clock } = approvalWorld();
  const request = ledger.request(FS_REQUEST);
  ledger.approve({ approvalId: request.approvalId, scope: 'once', approverKid: operator.kid });
  ledger.consume({
    approvalId: request.approvalId,
    resource: FS_REQUEST.resource,
    action: FS_REQUEST.action,
    target: FS_REQUEST.target,
    missionId: FS_REQUEST.missionId,
  });

  // The untouched chain re-imports and reconstructs identical state.
  const restored = new ApprovalLedger({ trustedApprovers: [operator.kid], now: clock });
  restored.importRecords(ledger.events());
  assert.equal(restored.verifyChain().length, 3);
  throwsCode(
    assert,
    () =>
      restored.consume({
        approvalId: request.approvalId,
        resource: FS_REQUEST.resource,
        action: FS_REQUEST.action,
        target: FS_REQUEST.target,
        missionId: FS_REQUEST.missionId,
      }),
    'NEXA_E_APPROVAL_USED',
  );

  // Flip the grant's scope — the hash no longer commits.
  const tampered = ledger.events().map((event, index) =>
    index === 1 ? { ...event, scope: 'mission' } : { ...event },
  );
  const victim = new ApprovalLedger({ trustedApprovers: [operator.kid], now: clock });
  throwsCode(assert, () => victim.importRecords(tampered), 'NEXA_E_APPROVAL_TAMPERED');

  // Truncation is detected against the persisted head.
  const head = ledger.verifyChain().head;
  throwsCode(assert, () => victim.importRecords(tampered.slice(0, 2), { head }), 'NEXA_E_APPROVAL_TAMPERED');
  // …and a clean re-import with the right head is accepted.
  assert.equal(new ApprovalLedger({ trustedApprovers: [operator.kid] }).importRecords(ledger.events(), { head }).length, 3);
});

// ---------------------------------------------------------------------------
// V7. Only trusted approvers may grant or deny
// ---------------------------------------------------------------------------
test('V7: an untrusted approver is refused; the request stays open for the trusted one', () => {
  const { ledger, operator, outsider } = approvalWorld();
  const request = ledger.request(FS_REQUEST);

  throwsCode(
    assert,
    () => ledger.approve({ approvalId: request.approvalId, scope: 'once', approverKid: outsider.kid }),
    'NEXA_E_UNTRUSTED',
  );
  throwsCode(
    assert,
    () => ledger.deny({ approvalId: request.approvalId, approverKid: outsider.kid }),
    'NEXA_E_UNTRUSTED',
  );
  // Still REQUESTED — the operator can still decide it.
  assert.equal(
    ledger.approve({ approvalId: request.approvalId, scope: 'once', approverKid: operator.kid })
      .decision,
    'APPROVED_ONCE',
  );
});

// ---------------------------------------------------------------------------
// V8. Mission-scoped approvals cannot escape the mission
// ---------------------------------------------------------------------------
test('V8: a mission-approval is reusable inside its mission and dead outside it', () => {
  const { ledger, operator } = approvalWorld();
  const request = ledger.request(FS_REQUEST);
  ledger.approve({ approvalId: request.approvalId, scope: 'mission', approverKid: operator.kid });

  // Wrong mission — refused, and nothing is consumed.
  throwsCode(
    assert,
    () =>
      ledger.consume({
        approvalId: request.approvalId,
        resource: FS_REQUEST.resource,
        action: FS_REQUEST.action,
        target: FS_REQUEST.target,
        missionId: 'm-999',
      }),
    'NEXA_E_APPROVAL_SCOPE',
  );
  // Same mission — reusable (that is the point of approve-mission).
  const args = {
    approvalId: request.approvalId,
    resource: FS_REQUEST.resource,
    action: FS_REQUEST.action,
    target: FS_REQUEST.target,
    missionId: FS_REQUEST.missionId,
  };
  assert.equal(ledger.consume(args).decision, 'CONSUMED');
  assert.equal(ledger.consume(args).decision, 'CONSUMED');
});
