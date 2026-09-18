/**
 * The Ω runtime: capability → policy → gate → receipt, and nothing else.
 *
 * Each test here is a property the runtime claims: a mission that succeeds is one whose
 * every effect was authorized and recorded; a mission that fails says why, and the "why"
 * is in the transcript; and the transcript cannot be edited after the fact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyOmegaChain } from '../packages/runtime/index.js';
import { compileSource, compileExample, sessionFor, runExample, host, DEMO_SECRET } from './omega-helpers.mjs';

test('Ω/R1: a mission runs end to end and every step is recorded', () => {
  const { session, outcome } = runExample('repository-review.nexa', 'review');
  assert.equal(outcome.status, 'ALLOW');
  assert.equal(outcome.code, null);
  assert.equal(outcome.steps, 7);
  assert.equal(outcome.records.length, 18);
  assert.equal(outcome.receipts.length, 5, 'every executed call produced a kernel receipt');
  assert.deepEqual(outcome.contracts, [{ claim: 'repository inspected', ok: true }]);
  assert.equal(
    session.kernel.endpoint.evidence.entries().every((record) => record.sig.kid === session.kernel.endpoint.kid),
    true,
    'kernel evidence is signed by the kernel, not by the agent that asked',
  );
});

test('Ω/R2: the transcript verifies as a chain, and a single edit breaks it', () => {
  const { outcome } = runExample('repository-review.nexa', 'review');
  const chain = verifyOmegaChain(outcome.records);
  assert.equal(chain.ok, true);
  assert.equal(chain.length, 18);

  const forged = outcome.records.map((record) => ({ ...record }));
  forged[5].detail = { ...(forged[5].detail ?? {}), added_after_the_fact: true };
  const broken = verifyOmegaChain(forged);
  assert.equal(broken.ok, false);
  assert.match(broken.reason, /modified after sealing/);

  const truncated = outcome.records.slice(0, -2);
  assert.equal(verifyOmegaChain(truncated).ok, true, 'a prefix is a valid chain: records are appended, never removed');
});

test('Ω/R3: every call is bounded by its grant, and a spent grant is a refusal', () => {
  const { session, outcome } = runExample('repository-review.nexa', 'review');
  assert.equal(outcome.status, 'ALLOW');
  const grants = session.runtime.describe().grants;
  assert.equal(grants.every((grant) => grant.minted === 1), true, 'one call, one token');
  assert.deepEqual(grants.map((grant) => grant.name).sort(), ['echo.call', 'memory.read', 'memory.store', 'sanitizer.redact', 'world.read']);

  const second = session.runtime.run('review');
  assert.equal(second.status, 'DENY');
  assert.equal(second.code, 'OMEGA_E_BUDGET');
  assert.match(second.message, /minted its budget/);
});

test('Ω/R4: budgets are enforced — a mission cannot spend more steps than its policy allows', () => {
  const compiled = compileSource(`nexa omega 1

policy p {
    allow echo.call
    max_runtime 10s
    max_steps 2
}

instrument echo {
    resource "tool:echo"
    actions call
}

agent a {
    role implementation
    model provider.auto
    allow echo.call
}

grant echo.call {
    subject a
    ttl 1m
    max_calls 10
}

mission burn {
    goal "spend steps"
    agent a

    plan { a b c d }

    do echo.call(text: "1") as a
    do echo.call(text: "2") as b
    do echo.call(text: "3") as c
    emit c
}
`);
  const outcome = sessionFor(compiled).runtime.run('burn');
  assert.equal(outcome.status, 'DENY');
  assert.equal(outcome.code, 'OMEGA_E_BUDGET');
  assert.equal(outcome.steps, 3, 'the budget stops the mission before the over-budget step');
});

test('Ω/R5: a closed gate refuses a well-typed module, and the refusal is evidence', () => {
  const { outcome } = runExample('gated-write.nexa', 'write-report');
  assert.equal(outcome.status, 'DENY');
  assert.equal(outcome.code, 'NEXA_E_GATE');
  const refusal = outcome.records.find((record) => record.kind === 'GATE_REFUSAL');
  assert.equal(refusal.detail.gate, 'FILESYSTEM_WRITE');
  assert.equal(refusal.detail.state, 'CLOSED');
  assert.equal(outcome.receipts.length, 1, 'even the refusal is receipted');
});

test('Ω/R6: a contract without evidence fails the mission, after it ran', () => {
  // The claim is *reachable* (the analyser accepts the contract) but the branch never
  // runs, so at the end of the mission the evidence does not exist. This is the
  // difference between a static check and a proof.
  const compiled = compileSource(`nexa omega 1

policy p {
    allow echo.call, sanitizer.redact
    max_runtime 10s
}

instrument echo {
    resource "tool:echo"
    actions call
    trust verified
}

agent a {
    role implementation
    model provider.auto
    allow echo.call, sanitizer.redact
}

grant echo.call {
    subject a
    ttl 1m
    max_calls 1
}

grant sanitizer.redact {
    subject a
    ttl 1m
    max_calls 1
}

mission m {
    goal "claim something never proven"
    agent a

    require evidence "the repository was inspected"

    plan { call }

    do echo.call(text: "hello") as echoed
    let clean: VerifiedData = untaint echoed as VerifiedData via sanitizer.redact(text: "ok")

    if false {
        evidence claim "the repository was inspected" from clean
    }

    emit clean
}
`);
  assert.equal(compiled.ok, true, 'the contract is reachable, so the module compiles');
  const outcome = sessionFor(compiled).runtime.run('m');
  assert.equal(outcome.status, 'DENY');
  assert.equal(outcome.code, 'OMEGA_E_CONTRACT_UNMET');
  assert.deepEqual(outcome.contracts, [{ claim: 'the repository was inspected', ok: false }]);
  const unmet = outcome.records.find((record) => record.kind === 'CONTRACT_UNMET');
  assert.deepEqual(unmet.detail.missing, ['the repository was inspected']);
});

test('Ω/R6b: a conditional runs the branch its condition selects, and records which', () => {
  const compiled = compileSource(`nexa omega 1

policy p {
    allow echo.call
    max_runtime 10s
}

instrument echo {
    resource "tool:echo"
    actions call
}

agent a {
    role implementation
    model provider.auto
    allow echo.call
}

grant echo.call {
    subject a
    ttl 1m
    max_calls 2
}

mission m {
    goal "branch"
    agent a

    plan { decide }

    do echo.call(text: "first") as first

    if 1 > 2 {
        do echo.call(text: "unreachable") as never
    } else {
        do echo.call(text: "taken") as taken
    }

    emit first
}
`);
  assert.equal(compiled.ok, true);
  const outcome = sessionFor(compiled).runtime.run('m');
  assert.equal(outcome.status, 'ALLOW');
  const branches = outcome.records.filter((record) => record.kind === 'PLAN' && record.detail.branch !== undefined);
  assert.deepEqual(branches.map((record) => record.detail.branch), ['else']);
  assert.equal(outcome.records.filter((record) => record.kind === 'TOOL_CALL').length, 2, 'the untaken branch never called anything');
});

test('Ω/R7: secrets stay in the vault — only a handle reaches the transcript', () => {
  const { outcome } = runExample('provider-secrets.nexa', 'summarise');
  assert.equal(outcome.status, 'ALLOW');
  assert.equal(outcome.value.handle, 'vault://gemini');
  assert.equal(outcome.value.secret_used, true);
  assert.equal(outcome.value.text.includes(DEMO_SECRET), false);
  assert.equal(JSON.stringify(outcome.records).includes(DEMO_SECRET), false, 'no record holds the material');
  assert.equal(JSON.stringify(outcome.receipts).includes(DEMO_SECRET), false, 'no receipt holds the material');
  assert.equal(JSON.stringify(outcome.value).includes(DEMO_SECRET), false, 'the mission result does not hold it either');
  const sealed = outcome.records.find((record) => record.kind === 'SEAL');
  assert.ok(sealed !== undefined);
});

test('Ω/R8: memory stores digests, never values', () => {
  const { outcome } = runExample('repository-review.nexa', 'review');
  const write = outcome.records.find((record) => record.kind === 'MEMORY_WRITE');
  assert.equal(typeof write.detail.value_hash, 'string');
  assert.match(write.detail.value_hash, /^sha256:/);
  assert.equal('value' in write.detail, false);
  const serialised = JSON.stringify(outcome.records);
  assert.equal(serialised.includes('hello world'), false, 'a memory record is not a copy of what it remembers');
});

test('Ω/R9: a failing resource is isolated by the breaker, classified, and recovered', () => {
  const flaky = compileSource(`nexa omega 1

policy p {
    allow echo.call
    max_runtime 10s
    max_steps 4
}

instrument echo {
    resource "tool:echo"
    actions call
}

agent a {
    role implementation
    model provider.auto
    allow echo.call
}

grant echo.call {
    subject a
    ttl 1m
    max_calls 4
}

mission heal {
    goal "call a tool that fails"
    agent a
    plan { attempt }
    do echo.call(text: "boom") as attempt
}
`);
  assert.equal(flaky.ok, true);
  const first = sessionFor(flaky);
  const breaker = first.runtime.breaker;
  const healer = first.runtime.healer;
  const sessions = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const session = sessionFor(flaky, { breaker, healer, instruments: [{ resource: 'tool:echo', handler: () => { throw new Error('handler exploded'); } }] });
    sessions.push(session.runtime.run('heal'));
  }
  assert.equal(sessions[0].status, 'DENY');
  assert.equal(sessions[0].code, 'NEXA_E_HANDLER');
  assert.equal(sessions[0].records.find((record) => record.kind === 'HEAL').detail.classification, 'transient');
  assert.equal(sessions[3].code, 'OMEGA_E_CIRCUIT_OPEN');
  assert.equal(sessions[3].records.find((record) => record.kind === 'CIRCUIT_OPEN') !== undefined, true);
  const recovery = healer.verify('tool:echo', true);
  assert.equal(recovery.phase, 'verify');
  assert.equal(recovery.action, 'recovered');
  assert.equal(breaker.check('tool:echo').open, false);
});

test('Ω/R10: a closed gate is a permanent refusal — the healer never routes around authority', () => {
  const breaker = sessionFor(compileExample('gated-write.nexa')).runtime.breaker;
  const healer = sessionFor(compileExample('gated-write.nexa')).runtime.healer;
  const session = sessionFor(compileExample('gated-write.nexa'), { breaker, healer });
  const outcome = session.runtime.run('write-report');
  assert.equal(outcome.code, 'NEXA_E_GATE');
  const heal = outcome.records.find((record) => record.kind === 'HEAL');
  assert.equal(heal.detail.classification, 'permanent');
  assert.equal(heal.detail.action, 'stop', 'no retry, no substitute: a closed gate stays closed');
});

test('Ω/R11: an unauthorized call never reaches the kernel', () => {
  const compiled = compileSource(`nexa omega 1

policy p {
    allow echo.call
    max_runtime 10s
}

instrument echo {
    resource "tool:echo"
    actions call
}

agent a {
    role implementation
    model provider.auto
    allow echo.call
}

mission m {
    goal "call without a grant"
    agent a
    plan { call }
    do echo.call(text: "hello") as echoed
    emit echoed
}
`);
  // The agent allows it and the policy allows it: without a grant there is no authority,
  // so the call dies before an envelope is ever built.
  const session = sessionFor(compiled);
  const outcome = session.runtime.run('m');
  assert.equal(outcome.status, 'DENY');
  assert.equal(outcome.code, 'OMEGA_E_GRANT_MISSING');
  assert.equal(session.kernel.endpoint.evidence.entries().length, 0, 'the kernel never saw the call');
});

test('Ω/R12: the runtime holds no keys — the operator is injected, not embedded', () => {
  const { session } = runExample('repository-review.nexa', 'review');
  assert.equal(typeof session.runtime.authority.issue, 'function');
  assert.equal('keys' in session.runtime, false);
  assert.equal('keys' in session.runtime.kernel, false);
  assert.equal(session.runtime.describe().module_hash.startsWith('sha256:'), true);
});

test('Ω/R13: the same module decides the same way twice, and produces different evidence', () => {
  const first = runExample('repository-review.nexa', 'review').outcome;
  const second = runExample('repository-review.nexa', 'review').outcome;
  const skeleton = (outcome) => outcome.records.map((record) => `${record.kind}:${record.decision}:${record.resource ?? ''}`);
  assert.deepEqual(skeleton(first), skeleton(second), 'the same input decides the same way');
  assert.notEqual(first.records.at(-1).hash, second.records.at(-1).hash, 'every run is its own evidence: nonces and messages are fresh');
  assert.equal(verifyOmegaChain(first.records).ok && verifyOmegaChain(second.records).ok, true);
});

test('Ω/R14: a mission name that does not exist is refused, not guessed', () => {
  const { session } = runExample('repository-review.nexa', 'review');
  assert.throws(() => session.runtime.run('does-not-exist'), (error) => error.code === 'OMEGA_E_NO_MISSION');
});
