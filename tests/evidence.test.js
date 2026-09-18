import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EvidenceLog,
  verifyEvidenceChain,
  createReceipt,
  verifyReceipt,
  matchReceiptToRecord,
  computeRecordHash,
  receiptPayload,
  GENESIS_PREV,
  EVIDENCE_KINDS,
} from '../packages/evidence/index.js';
import { KeyPair, base64url } from '../packages/crypto/index.js';
import { throwsCode, world, capabilityFor, T0 } from './helpers.mjs';

function logFor(scope) {
  return new EvidenceLog({ actor: scope.agent, clock: () => T0 });
}

test('a fresh log starts at genesis and chains each record to the previous hash', () => {
  const scope = world();
  const log = logFor(scope);
  assert.equal(log.length, 0);
  assert.equal(log.head, undefined);

  const first = log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, detail: {} });
  assert.equal(first.seq, 0);
  assert.equal(first.prev, GENESIS_PREV);
  assert.equal(first.hash, computeRecordHash(first));

  const second = log.append({ kind: 'GATE_BLOCKED', decision: 'DENY', subject: scope.caller.kid, resource: 'fs:/x', detail: { gate: 'FILESYSTEM_WRITE' } });
  assert.equal(second.prev, first.hash);
  assert.equal(log.head.hash, second.hash);

  const verification = verifyEvidenceChain(log.entries());
  assert.equal(verification.ok, true);
  assert.equal(verification.length, 2);
  assert.deepEqual(verification.actors, [scope.agent.kid]);
});

test('editing, deleting, reordering or re-signing records is detected', () => {
  const scope = world();
  const log = logFor(scope);
  log.append({ kind: 'ENVELOPE_ACCEPTED', decision: 'INFO', subject: scope.caller.kid, detail: { n: 1 } });
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, detail: { n: 2 } });
  log.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.caller.kid, detail: { n: 3 } });

  const edited = log.entries();
  edited[1].decision = 'DENY';
  assert.throws(() => verifyEvidenceChain(edited), /modified after sealing/);

  const deleted = log.entries();
  deleted.splice(1, 1);
  assert.throws(() => verifyEvidenceChain(deleted), /out of order|chain broken/);

  const reordered = log.entries().reverse();
  assert.throws(() => verifyEvidenceChain(reordered), /out of order/);

  const forged = log.entries();
  forged[0].sig = { alg: 'ed25519', kid: scope.agent.kid, val: base64url(Buffer.alloc(64)) };
  assert.throws(() => verifyEvidenceChain(forged), /invalid signature/);

  const byActor = log.entries();
  throwsCode(assert, () => verifyEvidenceChain(byActor, { expectActor: scope.caller.kid }), 'NEXA_E_UNTRUSTED');
  throwsCode(assert, () => verifyEvidenceChain(byActor, { expectLength: 9 }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => verifyEvidenceChain('nope'), 'NEXA_E_SCHEMA');
  // An empty chain is trivially valid: nothing was recorded, and that is knowable.
  assert.deepEqual(verifyEvidenceChain([]), { ok: true, length: 0, head: GENESIS_PREV, actors: [] });
});

test('the log is append-only: entries() hands out copies', () => {
  const scope = world();
  const log = logFor(scope);
  log.append({ kind: 'POLICY_DECISION', decision: 'DENY', subject: scope.caller.kid, detail: { reason: 'x' } });
  const copy = log.entries();
  copy[0].detail.reason = 'tampered';
  assert.equal(log.at(0).detail.reason, 'x');
  throwsCode(assert, () => log.at(7), 'NEXA_E_SCHEMA');
  assert.equal(typeof log.summary()[0].count, 'number');
});

test('record kinds and decisions are a closed set', () => {
  const scope = world();
  const log = logFor(scope);
  assert.equal(EVIDENCE_KINDS.includes('GATE_BLOCKED'), true);
  for (const kind of EVIDENCE_KINDS) {
    assert.equal(log.append({ kind, decision: 'INFO', subject: scope.caller.kid, detail: {} }).kind, kind);
  }
  throwsCode(assert, () => log.append({ kind: 'MADE_UP', decision: 'INFO', subject: scope.caller.kid }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => log.append({ kind: 'POLICY_DECISION', decision: 'MAYBE', subject: scope.caller.kid }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => log.append({ kind: 'POLICY_DECISION', decision: 'INFO', subject: 'not-a-kid' }), 'NEXA_E_IDENTITY');
  throwsCode(assert, () => new EvidenceLog({ actor: { kid: scope.agent.kid } }), 'NEXA_E_KEY');
});

test('receipts are signed, portable and bound to their record', () => {
  const scope = world();
  const log = logFor(scope);
  const record = log.append({
    kind: 'POLICY_DECISION',
    decision: 'ALLOW',
    subject: scope.caller.kid,
    capability: 'urn:nexa:cap:AAAAAAAAAAAAAAAAAAAAAA',
    detail: { rule: 'allow-echo' },
  });
  const receipt = createReceipt({ record, actor: scope.agent, chainHead: record.hash, ts: '2026-09-18T12:00:00Z' });

  const verified = verifyReceipt(receipt);
  assert.equal(verified.ok, true);
  assert.equal(verified.summary.decision, 'ALLOW');
  assert.equal(verified.summary.evidence_hash, record.hash);
  assert.equal(matchReceiptToRecord(receipt, record).ok, true);

  // Any edit invalidates it.
  throwsCode(assert, () => verifyReceipt({ ...receipt, decision: 'DENY' }), 'NEXA_E_SIG');
  throwsCode(assert, () => verifyReceipt({ ...receipt, extra: 1 }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => verifyReceipt({ ...receipt, actor: scope.worker.kid }), 'NEXA_E_SIG');
  throwsCode(assert, () => createReceipt({ record: { ...record, decision: 'INFO' }, actor: scope.agent }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => createReceipt({ record, actor: { kid: scope.agent.kid } }), 'NEXA_E_KEY');

  // A receipt for a different record is caught by the matcher.
  const other = log.append({ kind: 'HANDLER_RESULT', decision: 'DENY', subject: scope.caller.kid, detail: {} });
  const otherReceipt = createReceipt({ record: other, actor: scope.agent });
  throwsCode(assert, () => matchReceiptToRecord(otherReceipt, record), 'NEXA_E_SCHEMA');
});

test('the endpoint produces a verifiable receipt for every decision', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });

  const allowed = scope.endpoint.receive(
    scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: {}, capability }),
  );
  const denied = scope.endpoint.receive(
    scope.caller.call({ to: scope.agent.kid, resource: 'tool:nope', args: {}, capability }),
  );

  for (const result of [allowed, denied]) {
    assert.notEqual(result.receipt, null);
    assert.equal(verifyReceipt(result.receipt).ok, true);
    assert.equal(matchReceiptToRecord(result.receipt, result.record).ok, true);
    assert.equal(result.receipt.actor, scope.agent.kid);
    assert.equal(result.receipt.subject, scope.caller.kid);
  }
  assert.equal(allowed.receipt.decision, 'ALLOW');
  assert.equal(denied.receipt.decision, 'DENY');

  const chain = scope.endpoint.evidence.entries();
  assert.equal(verifyEvidenceChain(chain).ok, true);
  // The receipt of the last decision pins the chain head at that moment.
  assert.equal(denied.receipt.chain_head, denied.record.hash);
  assert.equal(chain.at(-1).hash, denied.record.hash);
});

test('a receipt cannot be forged by another actor', () => {
  const scope = world();
  const log = logFor(scope);
  const record = log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.caller.kid, detail: {} });
  const receipt = createReceipt({ record, actor: scope.agent });
  const impostor = KeyPair.generate();
  const forged = {
    ...receipt,
    sig: { alg: 'ed25519', kid: scope.agent.kid, val: impostor.sign(receiptPayload(receipt)) },
  };
  throwsCode(assert, () => verifyReceipt(forged), 'NEXA_E_SIG');
});
