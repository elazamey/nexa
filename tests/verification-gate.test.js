/**
 * Verification gate — "AI proposes, the verifier decides".
 *
 * These tests pin the rule documented in docs/agent-loop.md:
 * MOCK ≠ REAL ≠ EVIDENCE. A claim reaches PASS only through a verified,
 * independently-signed, real-runtime evidence chain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { EvidenceLog } from '../packages/evidence/index.js';
import { assessClaim, VERDICTS, LOOP_STAGES } from '../tools/verification-gate.mjs';
import { world, T0 } from './helpers.mjs';

function verifierLog(scope) {
  // The operator is the verifier: a key distinct from the proposing agent.
  return new EvidenceLog({ actor: scope.operator, clock: () => T0 });
}

function claimFor(scope) {
  return { subject: scope.worker.kid, proposer: scope.agent.kid, asserted: true };
}

test('only three verdicts exist and the loop contains an explicit repair cycle', () => {
  assert.deepEqual(VERDICTS, ['PASS', 'FAIL', 'BLOCKED']);
  for (const stage of ['AUTHORIZE', 'DIAGNOSE', 'REPAIR', 'RETEST', 'EVIDENCE']) {
    assert.ok(LOOP_STAGES.includes(stage), `${stage} must be an explicit stage`);
  }
  assert.ok(LOOP_STAGES.indexOf('AUTHORIZE') < LOOP_STAGES.indexOf('IMPLEMENT'));
  assert.ok(LOOP_STAGES.indexOf('VERIFY') < LOOP_STAGES.indexOf('DELIVER'));
});

test('"the agent says it is done" with no evidence is BLOCKED, never PASS', () => {
  const scope = world();
  const out = assessClaim({ claim: claimFor(scope), records: [], source: 'real' });
  assert.equal(out.verdict, 'BLOCKED');
  assert.match(out.reason, /self-asserted/);
});

test('mock-only evidence is BLOCKED even when it looks perfect', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.worker.kid, detail: { mock: true } });
  const out = assessClaim({ claim: claimFor(scope), records: log.entries(), source: 'mock' });
  assert.equal(out.verdict, 'BLOCKED');
  assert.match(out.reason, /mock evidence proves the contract/);
});

test('undeclared evidence source is BLOCKED (no silent upgrade from mock to real)', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.worker.kid, detail: {} });
  const out = assessClaim({ claim: claimFor(scope), records: log.entries() });
  assert.equal(out.verdict, 'BLOCKED');
});

test('evidence signed by the proposer itself is BLOCKED — the AI is not its own judge', () => {
  const scope = world();
  const selfLog = new EvidenceLog({ actor: scope.agent, clock: () => T0 });
  selfLog.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.worker.kid, detail: {} });
  const out = assessClaim({ claim: claimFor(scope), records: selfLog.entries(), source: 'real' });
  assert.equal(out.verdict, 'BLOCKED');
  assert.match(out.reason, /proposer signed its own evidence/);
});

test('a real, independently-signed HANDLER_RESULT/ALLOW is PASS', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject: scope.worker.kid, resource: 'tool:echo', detail: {} });
  log.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.worker.kid, resource: 'tool:echo', detail: { exit: 0 } });
  const out = assessClaim({ claim: claimFor(scope), records: log.entries(), source: 'real' });
  assert.equal(out.verdict, 'PASS');
  assert.equal(out.evidence.seq, 1);
});

test('a DENY or GATE_BLOCKED for the subject makes the claim FAIL regardless of the assertion', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'GATE_BLOCKED', decision: 'DENY', subject: scope.worker.kid, resource: 'fs:/etc', detail: { gate: 'FILESYSTEM_WRITE' } });
  const out = assessClaim({ claim: claimFor(scope), records: log.entries(), source: 'real' });
  assert.equal(out.verdict, 'FAIL');
  assert.equal(out.evidence.kind, 'GATE_BLOCKED');
});

test('a tampered chain is FAIL, not PASS', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'HANDLER_RESULT', decision: 'DENY', subject: scope.worker.kid, detail: {} });
  const forged = log.entries();
  forged[0].decision = 'ALLOW'; // the agent "fixes" the log instead of the bug
  const out = assessClaim({ claim: claimFor(scope), records: forged, source: 'real' });
  assert.equal(out.verdict, 'FAIL');
  assert.match(out.reason, /chain rejected/);
});

test('evidence about a different subject does not transfer to the claim', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.outsider.kid, detail: {} });
  const out = assessClaim({ claim: claimFor(scope), records: log.entries(), source: 'real' });
  assert.equal(out.verdict, 'BLOCKED');
  assert.match(out.reason, /says nothing about the claimed subject/);
});

test('the repair loop: FAIL → repair → RETEST produces PASS only from new real evidence', () => {
  const scope = world();
  const log = verifierLog(scope);
  log.append({ kind: 'HANDLER_RESULT', decision: 'DENY', subject: scope.worker.kid, detail: { attempt: 1 } });
  assert.equal(assessClaim({ claim: claimFor(scope), records: log.entries(), source: 'real' }).verdict, 'FAIL');

  // Repairing means producing a fresh run under a fresh subject/run id — the old
  // DENY stays in the chain forever; the verdict is about the new run.
  const rerun = verifierLog(scope);
  rerun.append({ kind: 'HANDLER_RESULT', decision: 'ALLOW', subject: scope.worker.kid, detail: { attempt: 2 } });
  assert.equal(assessClaim({ claim: claimFor(scope), records: rerun.entries(), source: 'real' }).verdict, 'PASS');
});
