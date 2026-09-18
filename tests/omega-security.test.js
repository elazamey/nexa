/**
 * Ω adversarial suite.
 *
 * Every test here is an attack. They are kept because a security property is only as
 * good as the attacks that keep failing against it, and because two of these attacks
 * have already found real defects: an unenforced step budget (the IR said `maxSteps`,
 * the machine read `max_steps`) and a broken `if` (the analyser replaced the condition
 * expression with its type attributes, so a conditional compiled and then died mid-run).
 *
 * Run alone: `node --test tests/omega-security.test.js`
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK_CATEGORIES,
  MIN_ATTACKS,
  createAttack,
  runAttacks,
  summarizeAttacks,
  evaluateGate,
  createManifest,
  capabilitiesOf,
  signManifest,
} from '../packages/evolution/index.js';
import { runAttackSuite } from '../tools/omega-attacks.mjs';
import { compileExample, sessionFor, SEEDS, T0 } from './omega-helpers.mjs';
import { createIdentity } from '../packages/identity/index.js';

const reports = runAttackSuite();
const byId = Object.fromEntries(reports.map((report) => [report.id, report]));

test('Ω/S1: every attack in every category is blocked', () => {
  assert.equal(reports.length >= MIN_ATTACKS, true, `${MIN_ATTACKS} attacks are the minimum`);
  assert.deepEqual([...new Set(reports.map((report) => report.category))].sort(), [...ATTACK_CATEGORIES].sort());
  const unblocked = reports.filter((report) => !report.blocked);
  assert.deepEqual(unblocked, [], `unblocked: ${unblocked.map((report) => `${report.id}(${report.code})`).join(', ')}`);
});

test('Ω/S2: the headline refusals carry the code they claim to carry', () => {
  assert.equal(byId['escalate-outside-allow'].code, 'OMEGA_E_CAP_MISSING');
  assert.equal(byId['exfiltrate-via-emit'].code, 'OMEGA_E_SECRET_EGRESS');
  assert.equal(byId['exfiltrate-through-a-provider'].code, 'OMEGA_E_SECRET_EGRESS');
  assert.equal(byId['replay-a-signed-envelope'].code, 'NEXA_E_REPLAY');
  assert.equal(byId['tamper-with-a-record'].code, 'OMEGA_E_CHAIN_BROKEN');
  assert.equal(byId['widen-authority'].code, 'OMEGA_E_GATE_STAGE');
  assert.equal(byId['exhaust-the-budget'].code, 'OMEGA_E_BUDGET');
  assert.equal(byId['poison-a-tool'].code, 'OMEGA_E_CIRCUIT_OPEN');
  assert.equal(byId['bypass-a-closed-gate'].code, 'NEXA_E_GATE');
  assert.equal(byId['confuse-a-tool'].code, 'OMEGA_E_DUPLICATE');
  assert.equal(byId['promote-untrusted-to-evidence'].code, 'OMEGA_E_EVIDENCE_UNTRUSTED');
  assert.ok(['OMEGA_E_SIGNATURE', 'OMEGA_E_NOT_ACTIVATOR'].includes(byId['forge-a-manifest'].code));
  assert.equal(byId['edit-a-signed-manifest'].code, 'OMEGA_E_SIGNATURE');
});

test('Ω/S3: an attack that throws something unmodelled counts as a failure, not a pass', () => {
  const crash = createAttack({
    id: 'crash-the-system',
    category: 'tool-confusion',
    description: 'an attack that produces a plain Error',
    run() {
      throw new TypeError('the system crashed in a way it does not model');
    },
  });
  const [report] = runAttacks([crash]);
  assert.equal(report.blocked, false);
  assert.equal(report.code, 'OMEGA_E_ADVERSARIAL_UNMODELLED');

  const refused = createAttack({
    id: 'refused-properly',
    category: 'tool-confusion',
    description: 'an attack the system refuses with a modelled code',
    run() {
      const error = new Error('refused');
      error.code = 'OMEGA_E_DUPLICATE';
      throw error;
    },
  });
  assert.equal(runAttacks([refused])[0].blocked, true);
});

test('Ω/S4: the gate re-counts the attack reports — a summary cannot lie', () => {
  // A candidate that supplies a *summary* rather than reports gets nothing.
  const summaryOnly = summarizeAttacks(undefined);
  assert.equal(summaryOnly.status, 'FAIL');

  // Three attacks, all blocked, is not a suite.
  const few = summarizeAttacks(reports.slice(0, 3));
  assert.equal(few.status, 'FAIL');
  assert.match(few.detail.reason, /are required|no attack was attempted/);

  // A category with no attack is a failed stage: absence of evidence again.
  const missingCategory = summarizeAttacks(reports.filter((report) => report.category !== 'replay'));
  assert.equal(missingCategory.status, 'FAIL');
  assert.deepEqual(missingCategory.detail.missing_categories, ['replay']);

  // One unblocked attack fails the stage.
  const withGap = reports.map((report) => (report.id === 'tamper-with-a-record' ? { ...report, blocked: false } : report));
  const gap = summarizeAttacks(withGap);
  assert.equal(gap.status, 'FAIL');
  assert.deepEqual(gap.detail.unblocked.map((attack) => attack.id), ['tamper-with-a-record']);

  assert.equal(summarizeAttacks(reports).status, 'PASS');
});

test('Ω/S5: a candidate cannot pass the gate by asserting that it attacked', () => {
  const evolver = createIdentity({ label: 'gate-attacker', seed: SEEDS.evolver });
  const compiled = compileExample('evolution-proposal.nexa');
  const manifest = signManifest(createManifest({
    module: 'planner',
    version: 5,
    parent: 4,
    source: 'nexa omega 1\n',
    compiled,
    capabilities: capabilitiesOf(compiled.ir),
    evolver,
    created: T0,
  }), evolver);
  const parent = signManifest(createManifest({
    module: 'planner', version: 4, source: 'nexa omega 1\n', compiled,
    capabilities: capabilitiesOf(compiled.ir), evolver, created: T0,
  }), evolver);
  const checks = {
    compile: { status: 'PASS' },
    types: { status: 'PASS' },
    capabilities: { status: 'PASS' },
    security: { status: 'PASS' },
    // The lie: a PASS with no attacks behind it.
    adversarial: { status: 'PASS', detail: {} },
    regression: { status: 'PASS' },
    benchmark: { status: 'PASS', detail: { measurements: {} } },
    policy: { status: 'PASS' },
  };
  const verdict = evaluateGate({ candidate: manifest, parent, checks, now: T0 });
  assert.equal(verdict.verdict, 'FAIL');
  assert.equal(verdict.failed, 'adversarial');
  assert.match(verdict.reason, /no attack results/);

  const honest = evaluateGate({
    candidate: manifest,
    parent,
    checks: { ...checks, adversarial: { status: 'PASS', detail: { attacks: reports } } },
    now: T0,
  });
  assert.equal(honest.verdict, 'PASS');
  assert.equal(honest.action, 'CANARY');
  assert.equal(honest.stages.find((stage) => stage.stage === 'adversarial').detail.blocked, reports.length);
});

test('Ω/S6: authority is bound to the grant and its subject — asking as someone else mints nothing', () => {
  const compiled = compileExample('repository-review.nexa');
  const session = sessionFor(compiled);
  const skeleton = { resource: 'tool:echo', action: 'call', args: {} };

  assert.throws(
    () => session.runtime.authority.issue({ agent: 'outsider', agentKid: `nexa:key:ed25519:${'z'.repeat(43)}`, ...skeleton }),
    (error) => error.code === 'OMEGA_E_GRANT_MISSING',
    'a grant names one subject',
  );
  assert.throws(
    () => session.runtime.authority.issue({ agent: 'reviewer', agentKid: `nexa:key:ed25519:${'z'.repeat(43)}`, resource: 'tool:echo', action: 'delete', args: {} }),
    (error) => error.code === 'OMEGA_E_GRANT_MISSING',
    'a grant names actions, not a namespace',
  );

  const issued = session.runtime.authority.issue({ agent: 'reviewer', agentKid: `nexa:key:ed25519:${'z'.repeat(43)}`, ...skeleton });
  assert.equal(issued.token.subject, `nexa:key:ed25519:${'z'.repeat(43)}`, 'the token is bound to the acting key');
  assert.equal(issued.grant.name, 'echo.call');
  assert.equal(issued.token.caveats.max_uses, 1, 'one call, one token');
});
