/**
 * v13-3 — Mission API + Event-Sourced Replay security vectors (test-first).
 *
 * Written BEFORE `packages/protocol/src/mission.js` exists — repo culture:
 * vectors before implementation. The mission log is the directed-mission
 * backbone (v13 map §2C, doc §35/§41): four independent layers per step
 * (PLANNED → AUTHORIZED → EXECUTED → VERIFIED), never mutated in place —
 * state is always derived by a pure deterministic reducer over a
 * hash-chained event log. Any edit, deletion or reorder breaks verification
 * with NEXA_E_MISSION_TAMPERED. There is no "probably completed".
 *
 * Deterministic: fixed clock, fixed ids, no network, no filesystem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MissionLog, reduceMissionEvents, MISSION_LAYERS } from '../packages/protocol/index.js';
import { T0, throwsCode } from './helpers.mjs';

const PLAN = [
  { kind: 'creative', target: 'meta:launch', protected: false, label: 'draft variants' },
  { kind: 'terminal', target: 'ls work', protected: true, label: 'list jail' },
  { kind: 'creative', target: 'tiktok:launch', protected: false, label: 'short cut' },
];

function missionWorld() {
  let current = T0;
  const log = new MissionLog({ now: () => current });
  const advance = (seconds) => {
    current = new Date(current.getTime() + seconds * 1000);
  };
  return { log, advance };
}

function createMission(log, plan = PLAN) {
  return log.create({ missionId: 'm-test-001', name: 'Campaign Launch', plan });
}

// ---------------------------------------------------------------------------
// V0. Success path — mixed protected/unprotected steps run to VERIFIED,
// and a from-scratch replay reproduces the identical state and head.
// ---------------------------------------------------------------------------
test('V0: planned → authorized → executed → verified, replay reproduces state and head', () => {
  const { log, advance } = missionWorld();
  const created = createMission(log);
  assert.equal(created.layer, 'PLANNED');
  assert.equal(created.steps, 3);

  // Step 0 — unprotected: authorize (no approval), execute, verify.
  advance(1);
  assert.equal(log.authorizeStep({ stepIndex: 0 }).layer, 'AUTHORIZED');
  advance(1);
  assert.equal(log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' }).layer, 'EXECUTED');
  advance(1);
  const v0 = log.verifyStep({ stepIndex: 0, verification: 'sha256:verify0' });
  assert.equal(v0.layer, 'VERIFIED');
  assert.equal(v0.missionLayer, 'EXECUTED'); // not all steps verified yet

  // Step 1 — protected: approval binding recorded, then executed with the same id.
  advance(1);
  const auth1 = log.authorizeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:aaa' });
  assert.equal(auth1.layer, 'AUTHORIZED');
  assert.equal(auth1.approvalId, 'urn:nexa:approval:aaa');
  advance(1);
  log.executeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:aaa', digest: 'sha256:exec1' });
  advance(1);
  log.verifyStep({ stepIndex: 1, verification: 'sha256:verify1' });

  // Step 2 — unprotected again.
  advance(1);
  log.authorizeStep({ stepIndex: 2 });
  advance(1);
  log.executeStep({ stepIndex: 2, digest: 'sha256:exec2' });
  advance(1);
  const done = log.verifyStep({ stepIndex: 2, verification: 'sha256:verify2' });
  assert.equal(done.missionLayer, 'VERIFIED');

  const state = log.state();
  assert.equal(state.layer, 'VERIFIED');
  assert.ok(state.verificationHash, 'completion commits to a verification hash');
  assert.equal(state.verificationHash, log.verifyChain().head);
  assert.deepEqual(state.steps.map((s) => s.layer), ['VERIFIED', 'VERIFIED', 'VERIFIED']);

  // From-scratch replay over the exported events reproduces everything.
  const replayed = log.replay();
  assert.equal(replayed.ok, true);
  assert.deepEqual(replayed.state, state);
  assert.equal(replayed.head, log.verifyChain().head);
});

// ---------------------------------------------------------------------------
// V1. Layer order — no skipping, no doubling, no out-of-order steps.
// ---------------------------------------------------------------------------
test('V1: transitions outside PLANNED → AUTHORIZED → EXECUTED → VERIFIED are refused', () => {
  const { log } = missionWorld();
  createMission(log);

  // Execute / verify before authorize.
  throwsCode(assert, () => log.executeStep({ stepIndex: 0, digest: 'sha256:x' }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.verifyStep({ stepIndex: 0, verification: 'sha256:x' }), 'NEXA_E_MISSION_STATE');
  // Step 1 cannot authorize while step 0 is still planned (sequential frontier).
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:aaa' }), 'NEXA_E_MISSION_STATE');

  log.authorizeStep({ stepIndex: 0 });
  // No double authorize, no verify-before-execute.
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 0 }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.verifyStep({ stepIndex: 0, verification: 'sha256:x' }), 'NEXA_E_MISSION_STATE');

  log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' });
  // No re-authorize / re-execute of an executed step.
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 0 }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' }), 'NEXA_E_MISSION_STATE');
});

// ---------------------------------------------------------------------------
// V2. Approval binding — protected steps need one id, unprotected need none,
// and the executed id must equal the authorized id.
// ---------------------------------------------------------------------------
test('V2: protected steps bind exactly one approval; swaps and strays are refused', () => {
  const { log } = missionWorld();
  createMission(log);
  log.authorizeStep({ stepIndex: 0 });
  log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' });
  log.verifyStep({ stepIndex: 0, verification: 'sha256:verify0' });

  // Protected step without an approval id.
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 1 }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 1, approvalId: '' }), 'NEXA_E_MISSION_STATE');

  log.authorizeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:aaa' });
  // Executing with a different approval than the authorized one.
  throwsCode(
    assert,
    () => log.executeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:bbb', digest: 'sha256:exec1' }),
    'NEXA_E_MISSION_STATE',
  );
  throwsCode(
    assert,
    () => log.executeStep({ stepIndex: 1, digest: 'sha256:exec1' }),
    'NEXA_E_MISSION_STATE',
  );

  log.executeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:aaa', digest: 'sha256:exec1' });
  log.verifyStep({ stepIndex: 1, verification: 'sha256:verify1' });

  // Unprotected step must not carry a stray approval binding.
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 2, approvalId: 'urn:nexa:approval:zzz' }), 'NEXA_E_MISSION_STATE');
});

// ---------------------------------------------------------------------------
// V3. Completion gate — VERIFIED exists only when every step verified;
// a failed mission can never complete.
// ---------------------------------------------------------------------------
test('V3: no completion without all-verified; failure is terminal', () => {
  const { log } = missionWorld();
  createMission(log);

  log.authorizeStep({ stepIndex: 0 });
  const failed = log.failStep({ stepIndex: 0, code: 'NEXA_E_HANDLER', reason: 'provider down' });
  assert.equal(failed.missionLayer, 'FAILED');
  assert.equal(log.state().layer, 'FAILED');

  // A failed mission accepts no further transitions — not even completion.
  throwsCode(assert, () => log.authorizeStep({ stepIndex: 1, approvalId: 'urn:nexa:approval:aaa' }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.executeStep({ stepIndex: 0, digest: 'sha256:x' }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.verifyStep({ stepIndex: 0, verification: 'sha256:x' }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.denyMission({ reason: 'too late' }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log.cancelMission({ reason: 'too late' }), 'NEXA_E_MISSION_STATE');

  // A denied mission is terminal too.
  const { log: log2 } = missionWorld();
  createMission(log2);
  assert.equal(log2.denyMission({ reason: 'human said no' }).missionLayer, 'DENIED');
  throwsCode(assert, () => log2.authorizeStep({ stepIndex: 0 }), 'NEXA_E_MISSION_STATE');

  // And VERIFIED is terminal: nothing moves after completion.
  const { log: log3 } = missionWorld();
  createMission(log3, [{ kind: 'creative', target: 'meta:solo', protected: false }]);
  log3.authorizeStep({ stepIndex: 0 });
  log3.executeStep({ stepIndex: 0, digest: 'sha256:e' });
  const done = log3.verifyStep({ stepIndex: 0, verification: 'sha256:v' });
  assert.equal(done.missionLayer, 'VERIFIED');
  const events = log3.events();
  assert.equal(events.at(-1).kind, 'MISSION_COMPLETED');
  assert.equal(events.at(-1).verificationHash, log3.verifyChain().head);
  throwsCode(assert, () => log3.authorizeStep({ stepIndex: 0 }), 'NEXA_E_MISSION_STATE');
  throwsCode(assert, () => log3.failStep({ stepIndex: 0, code: 'NEXA_E_HANDLER' }), 'NEXA_E_MISSION_STATE');
});

// ---------------------------------------------------------------------------
// V4. Field tamper — any edit to any event breaks the chain.
// ---------------------------------------------------------------------------
test('V4: editing any event is detected as NEXA_E_MISSION_TAMPERED', () => {
  const { log } = missionWorld();
  createMission(log);
  log.authorizeStep({ stepIndex: 0 });
  log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' });

  const flip = (mutate) => {
    const records = log.events();
    mutate(records);
    const { log: other } = missionWorld();
    throwsCode(assert, () => other.importEvents(records), 'NEXA_E_MISSION_TAMPERED');
  };

  // Flip the plan target inside the genesis event.
  flip((records) => {
    records[0].plan[1].target = 'rm -rf /';
  });
  // Flip an execution digest.
  flip((records) => {
    records[2].digest = 'sha256:forged';
  });
  // Rewrite history: turn an AUTHORIZED step into VERIFIED by editing kinds.
  flip((records) => {
    records[1].kind = 'STEP_VERIFIED';
  });
  // Splice an event from another mission id.
  flip((records) => {
    records[1].missionId = 'm-evil-999';
  });

  // The untouched log still verifies.
  assert.equal(log.verifyChain().ok, true);
});

// ---------------------------------------------------------------------------
// V5. Deletion / truncation — a dropped event breaks prev-linkage,
// and a short chain never matches the persisted head.
// ---------------------------------------------------------------------------
test('V5: deleted or truncated events are detected; honest prefixes restore', () => {
  const { log } = missionWorld();
  createMission(log);
  log.authorizeStep({ stepIndex: 0 });
  log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' });
  log.verifyStep({ stepIndex: 0, verification: 'sha256:verify0' });
  const full = log.events();
  const head = log.verifyChain().head;

  // Drop a middle event: prev-linkage breaks.
  const { log: dropped } = missionWorld();
  throwsCode(assert, () => dropped.importEvents(full.filter((_, i) => i !== 2)), 'NEXA_E_MISSION_TAMPERED');

  // Truncation vs the persisted head: internally consistent, but not our chain.
  const { log: cut } = missionWorld();
  throwsCode(assert, () => cut.importEvents(full.slice(0, 2), { head }), 'NEXA_E_MISSION_TAMPERED');

  // An honest prefix without a head claim restores the prefix state.
  const { log: restored } = missionWorld();
  const result = restored.importEvents(full.slice(0, 2));
  assert.equal(result.ok, true);
  assert.equal(result.length, 2);
  assert.equal(restored.state().steps[0].layer, 'AUTHORIZED');
  assert.equal(restored.verifyChain().head, full[1].hash);
});

// ---------------------------------------------------------------------------
// V6. Determinism — same inputs, same clock, same chain; the pure reducer
// agrees with the live log exactly.
// ---------------------------------------------------------------------------
test('V6: identical inputs produce identical chains; reducer equals live state', () => {
  const runOnce = () => {
    let current = T0;
    const log = new MissionLog({ now: () => current });
    const tick = () => {
      current = new Date(current.getTime() + 1000);
    };
    log.create({ missionId: 'm-determinism', name: 'Same', plan: PLAN });
    tick();
    log.authorizeStep({ stepIndex: 0 });
    tick();
    log.executeStep({ stepIndex: 0, digest: 'sha256:exec0' });
    tick();
    log.verifyStep({ stepIndex: 0, verification: 'sha256:verify0' });
    return log;
  };
  const a = runOnce();
  const b = runOnce();
  assert.deepEqual(a.events(), b.events());
  assert.equal(a.verifyChain().head, b.verifyChain().head);

  // The exported pure reducer derives the exact same state from bare events.
  const reduced = reduceMissionEvents(a.events());
  const live = a.state();
  assert.deepEqual(reduced, { ...live, head: a.verifyChain().head, length: a.events().length });
  assert.ok(Object.isFrozen(MISSION_LAYERS), 'layer vocabulary is frozen');
});

// ---------------------------------------------------------------------------
// V7. Unknown ids and malformed input — missing steps, empty plans,
// forged first events.
// ---------------------------------------------------------------------------
test('V7: unknown steps are MISSING; malformed and forged logs are refused', () => {
  const { log } = missionWorld();
  createMission(log);

  throwsCode(assert, () => log.authorizeStep({ stepIndex: 99 }), 'NEXA_E_MISSION_MISSING');
  throwsCode(assert, () => log.executeStep({ stepIndex: -1, digest: 'sha256:x' }), 'NEXA_E_MISSION_MISSING');
  throwsCode(assert, () => log.verifyStep({ stepIndex: 3, verification: 'sha256:x' }), 'NEXA_E_MISSION_MISSING');
  throwsCode(assert, () => log.failStep({ stepIndex: 7, code: 'NEXA_E_HANDLER' }), 'NEXA_E_MISSION_MISSING');

  // Malformed plans never become a mission.
  const { log: bad } = missionWorld();
  throwsCode(assert, () => bad.create({ missionId: 'm-x', name: 'X', plan: [] }), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => bad.create({ missionId: 'm-x', name: 'X' }), 'NEXA_E_SCHEMA');
  throwsCode(
    assert,
    () => bad.create({ missionId: 'm-x', name: 'X', plan: [{ kind: 'terminal', target: '', protected: true }] }),
    'NEXA_E_SCHEMA',
  );
  throwsCode(assert, () => bad.create({ missionId: '', name: 'X', plan: PLAN }), 'NEXA_E_SCHEMA');
  // A second genesis on the same log is a state violation, not a new mission.
  createMission(bad);
  throwsCode(assert, () => createMission(bad), 'NEXA_E_MISSION_STATE');

  // A forged log whose first event is not the genesis is tamper, not state.
  const { log: forged } = missionWorld();
  throwsCode(assert, () => forged.importEvents([]), 'NEXA_E_SCHEMA');
  throwsCode(assert, () => forged.importEvents('nope'), 'NEXA_E_SCHEMA');
  const { log: src } = missionWorld();
  createMission(src);
  src.authorizeStep({ stepIndex: 0 });
  const tailOnly = src.events().slice(1);
  throwsCode(assert, () => forged.importEvents(tailOnly), 'NEXA_E_MISSION_TAMPERED');
});
