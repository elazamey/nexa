/**
 * v13-4 — Unified Governance & Observability vectors (test-first).
 *
 * Written BEFORE `packages/protocol/src/usage.js` and before the
 * `ApprovalLedger.requests()` view exist — repo culture: vectors before
 * implementation. v13-4 is the governance surface over v13-1..v13-3:
 * a Unified Approval Center (every request, every scope, every decision),
 * real per-mission usage counters (runs, bytes, duration — cost $0.00 by
 * construction: local-first, no paid providers), and the honesty labels
 * (LIVE vs DEMO) the dashboard badges are bound to.
 *
 * Deterministic: fixed clock, fixed ids, no network, no filesystem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalLedger } from '../packages/policy/index.js';
import { UsageMeter, USAGE_KINDS } from '../packages/protocol/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { T0, SEEDS, throwsCode } from './helpers.mjs';

function approvalWorld() {
  let current = T0;
  const operator = createIdentity({ label: 'governance-operator', seed: SEEDS.operator });
  const ledger = new ApprovalLedger({ trustedApprovers: [operator.kid], now: () => current });
  const advance = (seconds) => {
    current = new Date(current.getTime() + seconds * 1000);
  };
  return { ledger, operator, advance };
}

const TERM_REQUEST = { resource: 'terminal:exec', action: 'exec', target: 'ls work' };

// ---------------------------------------------------------------------------
// U0. Usage record → summary aggregates runs, bytes, duration, tokens, $0.
// ---------------------------------------------------------------------------
test('U0: recorded usage aggregates into an honest per-mission summary', () => {
  const meter = new UsageMeter({ now: () => T0 });
  const r0 = meter.record({
    missionId: 'm-gov-001', stepIndex: 0, kind: 'creative',
    inputBytes: 120, outputBytes: 880, durationMs: 12,
  });
  assert.equal(r0.seq, 0);
  const r1 = meter.record({
    missionId: 'm-gov-001', stepIndex: 1, kind: 'terminal',
    inputBytes: 7, outputBytes: 64, durationMs: 8,
  });
  assert.equal(r1.seq, 1);

  const s = meter.summary('m-gov-001');
  assert.equal(s.missionId, 'm-gov-001');
  assert.equal(s.records, 2);
  assert.equal(s.steps, 2);
  assert.equal(s.failed, 0);
  assert.equal(s.byKind.terminal.runs, 1);
  assert.equal(s.byKind.creative.runs, 1);
  assert.equal(s.totals.inputBytes, 127);
  assert.equal(s.totals.outputBytes, 944);
  assert.equal(s.totals.durationMs, 20);
  assert.equal(s.tokensEstimated, Math.ceil(1071 / 4));
  assert.equal(s.costMicros, 0);
  assert.equal(s.currency, 'USD');
  assert.match(s.note, /no paid providers/);

  const all = meter.summaryAll();
  assert.equal(all.missions, 1);
  assert.equal(all.records, 2);
  assert.equal(all.costMicros, 0);
});

// ---------------------------------------------------------------------------
// U1. Failures are counted, never hidden; per-step entries are inspectable.
// ---------------------------------------------------------------------------
test('U1: failed executions are recorded and counted, entries stay inspectable', () => {
  const meter = new UsageMeter({ now: () => T0 });
  meter.record({
    missionId: 'm-gov-002', stepIndex: 0, kind: 'terminal',
    inputBytes: 20, outputBytes: 200, durationMs: 400, ok: false,
  });
  meter.record({
    missionId: 'm-gov-002', stepIndex: 0, kind: 'terminal',
    inputBytes: 20, outputBytes: 30, durationMs: 9, ok: true,
  });
  const s = meter.summary('m-gov-002');
  assert.equal(s.records, 2);
  assert.equal(s.steps, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.byKind.terminal.failed, 1);
  assert.equal(s.totals.durationMs, 409);

  const entries = meter.entries('m-gov-002');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].ok, false);
  assert.equal(entries[1].ok, true);
  entries[0].ok = true; // defensive copies — the meter is unaffected
  assert.equal(meter.summary('m-gov-002').failed, 1);
});

// ---------------------------------------------------------------------------
// U2. Unknown missions read as zeros (observational, never throws on read).
// ---------------------------------------------------------------------------
test('U2: an unknown mission summarizes to zeros instead of throwing', () => {
  const meter = new UsageMeter({ now: () => T0 });
  meter.record({
    missionId: 'm-gov-003', stepIndex: 0, kind: 'creative',
    inputBytes: 10, outputBytes: 10, durationMs: 1,
  });
  const s = meter.summary('m-never-existed');
  assert.equal(s.missionId, 'm-never-existed');
  assert.equal(s.records, 0);
  assert.equal(s.totals.inputBytes, 0);
  assert.equal(s.tokensEstimated, 0);
  assert.equal(s.costMicros, 0);
  assert.deepEqual(meter.entries('m-never-existed'), []);
});

// ---------------------------------------------------------------------------
// U3. Malformed usage is refused at the boundary.
// ---------------------------------------------------------------------------
test('U3: malformed usage records are refused with NEXA_E_SCHEMA', () => {
  const meter = new UsageMeter({ now: () => T0 });
  const good = {
    missionId: 'm-gov-004', stepIndex: 0, kind: 'terminal',
    inputBytes: 1, outputBytes: 1, durationMs: 1,
  };
  throwsCode(assert, () => meter.record({ ...good, missionId: '' }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.record({ ...good, stepIndex: -1 }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.record({ ...good, kind: 'browser' }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.record({ ...good, inputBytes: -5 }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.record({ ...good, outputBytes: 2 ** 40 }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.record({ ...good, durationMs: -1 }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.record({ ...good, ok: 'yes' }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => meter.summary(''), 'NEXA_E_SCHEMA');
  assert.ok(Object.isFrozen(USAGE_KINDS), 'usage kinds are frozen');
  assert.equal(meter.summary('m-gov-004').records, 0);
});

// ---------------------------------------------------------------------------
// U4. Determinism — same records, same clock, identical summaries.
// ---------------------------------------------------------------------------
test('U4: identical usage produces identical summaries', () => {
  const runOnce = () => {
    const meter = new UsageMeter({ now: () => T0 });
    meter.record({
      missionId: 'm-gov-005', stepIndex: 0, kind: 'creative',
      inputBytes: 100, outputBytes: 500, durationMs: 7,
    });
    meter.record({
      missionId: 'm-gov-005', stepIndex: 1, kind: 'terminal',
      inputBytes: 9, outputBytes: 41, durationMs: 11,
    });
    return meter;
  };
  const a = runOnce();
  const b = runOnce();
  assert.deepEqual(a.summary('m-gov-005'), b.summary('m-gov-005'));
  assert.deepEqual(a.entries(), b.entries());
});

// ---------------------------------------------------------------------------
// A0. requests() exposes every request for the Approval Center — defensively.
// ---------------------------------------------------------------------------
test('A0: the ledger lists every request with scope, decision and expiry', () => {
  const { ledger, operator } = approvalWorld();
  const first = ledger.request({ ...TERM_REQUEST, missionId: 'm-gov-010' });
  const second = ledger.request({ ...TERM_REQUEST, target: 'cat notes.txt', missionId: null });
  ledger.approve({ approvalId: first.approvalId, scope: 'mission', approverKid: operator.kid });

  const rows = ledger.requests();
  assert.equal(rows.length, 2);
  const once = rows.find((r) => r.approvalId === second.approvalId);
  const scoped = rows.find((r) => r.approvalId === first.approvalId);
  assert.equal(once.decision, 'REQUESTED');
  assert.equal(once.scope, null);
  assert.equal(once.missionId, null);
  assert.equal(once.gate, 'TERMINAL');
  assert.equal(once.expired, false);
  assert.equal(scoped.decision, 'APPROVED_MISSION');
  assert.equal(scoped.scope, 'mission');
  assert.equal(scoped.missionId, 'm-gov-010');
  assert.equal(scoped.approverKid, operator.kid);
  assert.ok(scoped.createdAt);
  assert.ok(scoped.exp);

  // Defensive copies: mutating the view never touches the ledger.
  once.decision = 'CONSUMED';
  scoped.target = 'rm -rf /';
  const reread = ledger.requests();
  assert.equal(reread.find((r) => r.approvalId === second.approvalId).decision, 'REQUESTED');
  assert.equal(reread.find((r) => r.approvalId === first.approvalId).target, 'ls work');
});

// ---------------------------------------------------------------------------
// A1. The view tracks the full lifecycle, including expiry.
// ---------------------------------------------------------------------------
test('A1: the request view follows consume and expiry', () => {
  const { ledger, operator, advance } = approvalWorld();
  const req = ledger.request({ ...TERM_REQUEST, missionId: 'm-gov-011', ttlSeconds: 60 });
  ledger.approve({ approvalId: req.approvalId, scope: 'once', approverKid: operator.kid });
  ledger.consume({
    approvalId: req.approvalId, resource: TERM_REQUEST.resource,
    action: TERM_REQUEST.action, target: TERM_REQUEST.target, missionId: 'm-gov-011',
  });
  assert.equal(ledger.requests()[0].decision, 'CONSUMED');

  const pending = ledger.request({ ...TERM_REQUEST, target: 'echo late', ttlSeconds: 60 });
  assert.equal(
    ledger.requests().find((r) => r.approvalId === pending.approvalId).expired,
    false,
  );
  advance(61);
  assert.equal(
    ledger.requests().find((r) => r.approvalId === pending.approvalId).expired,
    true,
  );
});

// ---------------------------------------------------------------------------
// A2. stats() keeps its shape (regression guard for the new accessor).
// ---------------------------------------------------------------------------
test('A2: stats counters stay consistent with the request view', () => {
  const { ledger, operator } = approvalWorld();
  const a = ledger.request({ ...TERM_REQUEST, missionId: 'm-gov-012' });
  ledger.request({ ...TERM_REQUEST, target: 'echo b' });
  ledger.approve({ approvalId: a.approvalId, scope: 'once', approverKid: operator.kid });
  const stats = ledger.stats();
  const rows = ledger.requests();
  assert.equal(stats.requests, rows.length);
  assert.equal(stats.decisions.APPROVED_ONCE, rows.filter((r) => r.decision === 'APPROVED_ONCE').length);
  assert.equal(stats.decisions.REQUESTED, rows.filter((r) => r.decision === 'REQUESTED').length);
});
