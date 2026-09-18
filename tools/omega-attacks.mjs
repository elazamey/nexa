#!/usr/bin/env node
/**
 * The adversarial suite, for real.
 *
 * Attacks, one per category the design names. Each one *tries* — against the actual
 * compiler, the actual runtime, the actual protocol endpoint and the actual Evolution
 * Gate — and reports whether the system blocked it. `runAttacks` treats an unmodelled
 * exception as a failed block, so a crash counts as a finding, not as a pass.
 *
 * The suite already earned its keep: `exhaust-the-budget` found that the IR emitted
 * `maxSteps` while the machine read `max_steps`, so every module's step budget was
 * silently unenforced. That is the point of attacking your own system in CI rather than
 * describing it in a document.
 *
 * Used by the Ω demo, by the tests, and by the `adversarial` stage of the Evolution Gate.
 *
 *   node tools/omega-attacks.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatInstant } from '../packages/ast/index.js';
import { compile } from '../packages/compiler/index.js';
import { createIdentity } from '../packages/identity/index.js';
import { Policy } from '../packages/policy/index.js';
import { Endpoint } from '../packages/protocol/index.js';
import { mintCapability } from '../packages/capability/index.js';
import {
  CircuitBreaker,
  ProviderRegistry,
  Vault,
  World,
  openSession,
  verifyOmegaChain,
} from '../packages/runtime/index.js';
import {
  createAttack,
  createManifest,
  capabilitiesOf,
  evaluateGate,
  runAttacks,
  signManifest,
} from '../packages/evolution/index.js';
import { buildCodingOrganism, createCell, createGuarantor, seedFor } from '../packages/cell/index.js';
import { planFusion, runFusion, specialize } from '../packages/cellular-evolution/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = new Date('2026-09-18T12:00:00Z');
const clock = () => T0;

const OPERATOR = createIdentity({ label: 'omega-attack-operator', seed: '11'.repeat(32) });
const EVOLVER = createIdentity({ label: 'omega-attack-evolver', seed: '44'.repeat(32) });
const OUTSIDER = createIdentity({ label: 'omega-attack-outsider', seed: '66'.repeat(32) });
const SEEDS = { outsider: '66'.repeat(32), evolver: '44'.repeat(32) };
const VAULT = new Vault({ secrets: { gemini: 'AIza-demo-not-a-real-key' } });

/** @param {string} name @param {string} source @returns {object} */
function compileSource(name, source) {
  return compile(source, { path: `attacks/${name}.nexa` });
}

/** @param {string} name @returns {{source: string, compiled: object}} */
function example(name) {
  const source = readFileSync(join(root, 'examples/omega', name), 'utf8');
  return { source, compiled: compileSource(name.replace(/\.nexa$/, ''), source) };
}

/** @param {object} compiled @returns {object} a session over the demo host */
function sessionFor(compiled) {
  return openSession({
    compiled,
    operator: OPERATOR,
    clock,
    world: new World({ state: { project: { name: 'nexa' } } }),
    instruments: [{ resource: 'tool:echo', handler: ({ args }) => ({ echoed: args }) }],
    breaker: new CircuitBreaker({ clock, threshold: 3 }),
    vault: VAULT,
  });
}

/**
 * Build a one-mission module from parts and assert that the compiler refuses it.
 *
 * @param {{id: string, category: string, description: string, allow?: string,
 *          instruments?: string, grants?: string, body: string, expect?: string}} probe
 * @returns {object} an attack
 */
function compileAttack({ id, category, description, allow = 'secrets.load, model.invoke', instruments = '', grants = '', body, expect = null }) {
  return createAttack({
    id,
    category,
    description,
    run() {
      const compiled = compileSource(id, `nexa omega 1

policy project {
    allow ${allow}
    max_runtime 10s
    max_steps 64
}

${instruments}
agent probe {
    role implementation
    model provider.auto
    allow ${allow}
}

${grants}
mission probe-mission {
    goal "probe"
    agent probe

    plan { p }

${body}
}
`);
      const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (compiled.ok) return { blocked: false, detail: { reason: 'the module compiled' } };
      if (errors.length === 0) return { blocked: false, detail: { reason: 'refused without an error diagnostic' } };
      if (expect !== null && !errors.some((error) => error.code === expect)) {
        return { blocked: false, code: errors[0].code, detail: { reason: `expected ${expect}`, codes: errors.map((error) => error.code) } };
      }
      return { blocked: true, code: errors[0].code, detail: { codes: errors.map((error) => error.code) } };
    },
  });
}

/** An all-blocked report set, for probes that need the gate to reach a later stage. */
const BLOCKED_REPORTS = [
  { id: 'probe-a', category: 'tampering', blocked: true, code: 'OMEGA_E_CHAIN_BROKEN' },
  { id: 'probe-b', category: 'replay', blocked: true, code: 'NEXA_E_REPLAY' },
  { id: 'probe-c', category: 'capability-escalation', blocked: true, code: 'OMEGA_E_CAP_MISSING' },
  { id: 'probe-d', category: 'secret-exfiltration', blocked: true, code: 'OMEGA_E_SECRET_EGRESS' },
  { id: 'probe-e', category: 'invalid-signature', blocked: true, code: 'OMEGA_E_SIGNATURE' },
  { id: 'probe-f', category: 'scope-widening', blocked: true, code: 'OMEGA_E_GATE_STAGE' },
  { id: 'probe-g', category: 'resource-exhaustion', blocked: true, code: 'OMEGA_E_BUDGET' },
  { id: 'probe-h', category: 'policy-bypass', blocked: true, code: 'NEXA_E_GATE' },
  { id: 'probe-i', category: 'tool-confusion', blocked: true, code: 'OMEGA_E_DUPLICATE' },
  { id: 'probe-j', category: 'untrusted-to-evidence', blocked: true, code: 'OMEGA_E_EVIDENCE_UNTRUSTED' },
];

export const SECRET_GRANT = `grant secrets.load {
    subject probe
    ttl 1m
    max_calls 40
}`;

/** @returns {object[]} every attack, in category order */
export function attackSuite() {
  const review = example('repository-review.nexa');
  const gated = example('gated-write.nexa');
  const leaky = example('refused-secret-egress.nexa');
  const sample = example('evolution-proposal.nexa');
  const checks = (extra = {}) => ({
    compile: { status: 'PASS' },
    types: { status: 'PASS' },
    capabilities: { status: 'PASS' },
    security: { status: 'PASS' },
    adversarial: { status: 'PASS', detail: { attacks: BLOCKED_REPORTS } },
    regression: { status: 'PASS' },
    benchmark: { status: 'PASS', detail: { measurements: {} } },
    policy: { status: 'PASS' },
    ...extra,
  });
  const manifestFor = (overrides) => signManifest(createManifest({
    module: 'planner',
    version: 5,
    parent: 4,
    source: sample.source,
    compiled: sample.compiled,
    capabilities: capabilitiesOf(sample.compiled.ir),
    evolver: EVOLVER,
    created: T0,
    ...overrides,
  }), overrides.evolver ?? EVOLVER);

  return [
    compileAttack({
      id: 'escalate-outside-allow',
      category: 'capability-escalation',
      description: 'an agent calls a resource its own allow-list does not name',
      body: '    do fs.delete("/") as gone\n    emit gone',
      expect: 'OMEGA_E_CAP_MISSING',
    }),

    compileAttack({
      id: 'exfiltrate-via-emit',
      category: 'secret-exfiltration',
      description: 'a loaded secret is emitted as the mission result',
      grants: SECRET_GRANT,
      body: '    let key: SecretString = secrets.load(name: "gemini")\n    emit key',
      expect: 'OMEGA_E_SECRET_EGRESS',
    }),
    createAttack({
      id: 'exfiltrate-through-a-provider',
      category: 'secret-exfiltration',
      description: 'a credential is attached to an adapter that does not accept one, and an accepting adapter tries to return it',
      run() {
        const strict = new ProviderRegistry({ vault: VAULT });
        try {
          strict.invoke({ provider: 'local', payload: {}, handle: { handle: 'vault://gemini' } });
          return { blocked: false, detail: { reason: 'a credential reached an adapter that does not accept one' } };
        } catch (cause) {
          if (cause.code !== 'OMEGA_E_SECRET_EGRESS') throw cause;
        }
        const echo = new ProviderRegistry({
          vault: VAULT,
          adapters: { echoer: { cost: 0, accepts_secret: true, invoke: ({ secret }) => ({ text: `here it is: ${secret}` }) } },
        });
        try {
          const result = echo.invoke({ provider: 'echoer', payload: {}, handle: { handle: 'vault://gemini' } });
          return { blocked: false, detail: { reason: 'an adapter echoed the credential back', result } };
        } catch (cause) {
          if (cause.code !== 'OMEGA_E_SECRET_EGRESS') throw cause;
          return { blocked: true, code: cause.code, detail: { checks: 2 } };
        }
      },
    }),

    createAttack({
      id: 'replay-a-signed-envelope',
      category: 'replay',
      description: 'a valid signed CALL envelope is delivered twice',
      run() {
        const agent = createIdentity({ label: 'replay-agent', kind: 'agent', seed: 'b2'.repeat(32) });
        const endpoint = new Endpoint({
          identity: agent,
          clock,
          capabilityIssuers: [OPERATOR.kid],
          policy: new Policy({ rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] }] }),
        });
        endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
        endpoint.trust.pin(OPERATOR.document);
        const caller = new Endpoint({ identity: OPERATOR, clock });
        caller.trust.pin(agent.document);

        const capability = mintCapability({
          issuer: OPERATOR,
          subject: OPERATOR.kid,
          resource: 'tool:echo',
          actions: ['call'],
          caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 5, max_depth: 0 },
        });
        const envelope = caller.call({ to: agent.kid, resource: 'tool:echo', args: {}, capability });
        const first = endpoint.receive(envelope);
        if (first.decision !== 'ALLOW') return { blocked: false, detail: { reason: 'the honest envelope was refused', code: first.code } };
        const second = endpoint.receive(envelope);
        if (second.code !== 'NEXA_E_REPLAY') return { blocked: false, detail: { reason: 'a replayed envelope was not detected', code: second.code } };
        return { blocked: true, code: second.code, detail: { replay_state: endpoint.replay.size } };
      },
    }),

    createAttack({
      id: 'tamper-with-a-record',
      category: 'tampering',
      description: 'a sealed evidence record is edited after the fact',
      run() {
        const outcome = sessionFor(review.compiled).runtime.run('review');
        const honest = verifyOmegaChain(outcome.records);
        if (!honest.ok) return { blocked: false, detail: { reason: 'the honest chain did not verify', chain: honest } };
        // A single byte of difference is enough: the record's hash covers every field.
        const forged = outcome.records.map((record) => ({ ...record }));
        forged[2].detail = { ...(forged[2].detail ?? {}), tampered: true };
        const after = verifyOmegaChain(forged);
        if (after.ok) return { blocked: false, detail: { reason: 'the tampered chain verified' } };
        return { blocked: true, code: after.code ?? 'OMEGA_E_CHAIN_BROKEN', detail: { reason: after.reason } };
      },
    }),

    createAttack({
      id: 'forge-a-manifest',
      category: 'invalid-signature',
      description: 'a manifest is signed by an identity the deployment does not trust',
      run() {
        const candidate = manifestFor({ evolver: OUTSIDER });
        const verdict = evaluateGate({ candidate, parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
        if (verdict.verdict === 'PASS') return { blocked: false, detail: { verdict: verdict.verdict } };
        return { blocked: true, code: verdict.code, detail: { verdict: verdict.verdict, reason: verdict.reason } };
      },
    }),
    createAttack({
      id: 'edit-a-signed-manifest',
      category: 'invalid-signature',
      description: 'a manifest field is edited after signing',
      run() {
        const forged = { ...manifestFor({}), version: 6 };
        const verdict = evaluateGate({ candidate: forged, parent: null, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
        if (verdict.verdict === 'PASS') return { blocked: false, detail: { verdict: verdict.verdict } };
        return { blocked: true, code: verdict.code, detail: { verdict: verdict.verdict, reason: verdict.reason } };
      },
    }),

    createAttack({
      id: 'widen-authority',
      category: 'scope-widening',
      description: 'a candidate adds a capability its parent never had',
      run() {
        const parent = signManifest(createManifest({
          module: 'planner', version: 4, source: sample.source, compiled: sample.compiled,
          capabilities: capabilitiesOf(sample.compiled.ir), evolver: EVOLVER, created: T0,
        }), EVOLVER);
        const candidate = signManifest(createManifest({
          module: 'planner', version: 5, parent: 4, source: sample.source, compiled: sample.compiled,
          capabilities: [...capabilitiesOf(sample.compiled.ir), 'fs:*!write'], evolver: EVOLVER, created: T0,
        }), EVOLVER);
        const verdict = evaluateGate({ candidate, parent, checks: checks(), evolvers: [EVOLVER.kid], now: T0 });
        if (verdict.verdict === 'PASS') return { blocked: false, detail: { verdict: verdict.verdict } };
        return { blocked: true, code: verdict.code, detail: { failed: verdict.failed, reason: verdict.reason } };
      },
    }),

    createAttack({
      id: 'exhaust-the-budget',
      category: 'resource-exhaustion',
      description: 'a mission that spends more steps than its policy allows',
      run() {
        const compiled = compileSource('budget', `nexa omega 1

policy project {
    allow secrets.load
    max_runtime 10s
    max_steps 2
}

agent probe {
    role implementation
    model provider.auto
    allow secrets.load
}

grant secrets.load {
    subject probe
    ttl 1m
    max_calls 40
}

mission burn {
    goal "spend steps"
    agent probe

    plan { a b c d }

    let a: SecretString = secrets.load(name: "gemini")
    let b: SecretString = secrets.load(name: "gemini")
    let c: SecretString = secrets.load(name: "gemini")
    seal c
    emit "done"
}
`);
        const outcome = sessionFor(compiled).runtime.run('burn');
        if (outcome.status === 'ALLOW') return { blocked: false, detail: { steps: outcome.steps, reason: 'the budget was not enforced' } };
        return { blocked: true, code: outcome.code, detail: { steps: outcome.steps, limit: compiled.ir.limits.max_steps } };
      },
    }),
    createAttack({
      id: 'poison-a-tool',
      category: 'resource-exhaustion',
      description: 'a tool that always fails is called until the breaker isolates it',
      run() {
        const breaker = new CircuitBreaker({ clock, threshold: 3 });
        for (let attempt = 0; attempt < 3; attempt += 1) breaker.record('tool:flaky', false);
        const state = breaker.check('tool:flaky');
        if (!state.open) return { blocked: false, detail: { state } };
        return { blocked: true, code: 'OMEGA_E_CIRCUIT_OPEN', detail: { cooldown_remaining_ms: state.cooldown_remaining_ms } };
      },
    }),

    createAttack({
      id: 'bypass-a-closed-gate',
      category: 'policy-bypass',
      description: 'a well-typed module tries to write to the filesystem anyway',
      run() {
        if (!gated.compiled.ok) return { blocked: false, detail: { reason: 'the probe module no longer compiles' } };
        const outcome = sessionFor(gated.compiled).runtime.run('write-report');
        if (outcome.status === 'ALLOW') return { blocked: false, detail: { reason: 'the gate let a write through' } };
        return { blocked: true, code: outcome.code, detail: { gate: outcome.records.find((record) => record.kind === 'GATE_REFUSAL')?.detail?.gate ?? null } };
      },
    }),

    createAttack({
      id: 'confuse-a-tool',
      category: 'tool-confusion',
      description: 'a second instrument claims a resource that is already registered',
      run() {
        try {
          openSession({
            compiled: review.compiled,
            operator: OPERATOR,
            clock,
            world: new World({ state: {} }),
            instruments: [
              { resource: 'tool:echo', handler: () => ({ first: true }) },
              { resource: 'tool:echo', handler: () => ({ second: true }) },
            ],
            breaker: new CircuitBreaker({ clock, threshold: 3 }),
          });
          return { blocked: false, detail: { reason: 'a duplicate instrument was accepted' } };
        } catch (cause) {
          if (cause.code === 'OMEGA_E_DUPLICATE') return { blocked: true, code: cause.code };
          throw cause;
        }
      },
    }),

    // --- the cellular layer: authority that composes is authority that can leak ------

    createAttack({
      id: 'message-without-a-capability',
      category: 'capability-escalation',
      description: 'a cell is addressed directly, with no capability at all',
      run() {
        const { cells, tissues } = buildCodingOrganism({ clock });
        const verdict = cells.coder.receive({
          from: 'planner',
          from_kid: tissues.coding.cell('planner').kid,
          receptor: 'implement',
          payload: { steps: ['climb'] },
        });
        if (verdict.ok === false && verdict.code === 'OMEGA_E_CAP_MISSING' && verdict.step === 'capability') {
          return { blocked: true, code: verdict.code, detail: { step: verdict.step } };
        }
        return { blocked: false, detail: { code: verdict.code ?? null, step: verdict.step ?? null } };
      },
    }),

    createAttack({
      id: 'call-across-an-undeclared-route',
      category: 'policy-bypass',
      description: 'a cell calls a cell the tissue contract never connected it to',
      run() {
        const { tissues } = buildCodingOrganism({ clock });
        const before = tissues.coding.usage();
        const verdict = tissues.coding.send({ from: 'coder', to: 'planner', receptor: 'plan', payload: { request: 'climb' } });
        const spent = JSON.stringify(tissues.coding.usage()) !== JSON.stringify(before);
        if (verdict.ok === false && verdict.code === 'OMEGA_E_ROUTE' && !spent) {
          return { blocked: true, code: verdict.code, detail: { contract: verdict.detail.contract.length } };
        }
        return { blocked: false, detail: { code: verdict.code ?? null, spent_a_capability: spent } };
      },
    }),

    createAttack({
      id: 'replay-a-spent-capability',
      category: 'replay',
      description: 'a capability that already crossed a membrane is presented again',
      run() {
        const { tissues, guarantor } = buildCodingOrganism({ clock });
        const coder = tissues.coding.cell('coder');
        const issued = guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
        const message = { from: 'coder', from_kid: coder.kid, receptor: 'run', payload: { patch: 'p' }, capability: issued.token };
        const first = tissues.coding.cell('tester').receive(message);
        const second = tissues.coding.cell('tester').receive(message);
        if (first.ok === true && second.ok === false && second.code === 'NEXA_E_REPLAY') {
          return { blocked: true, code: second.code, detail: { grant: first.detail.grant.id } };
        }
        return { blocked: false, detail: { first: first.code ?? 'ALLOW', second: second.code ?? 'ALLOW' } };
      },
    }),

    createAttack({
      id: 'present-another-cells-capability',
      category: 'capability-escalation',
      description: 'a cell presents a capability that was minted for a different presenter',
      run() {
        const { tissues, guarantor } = buildCodingOrganism({ clock });
        const coder = tissues.coding.cell('coder');
        const issued = guarantor.issue({ from: 'coder', fromKid: coder.kid, to: 'tester', receptor: 'run', args: {} });
        const verdict = tissues.coding.cell('tester').receive({
          from: 'coder',
          from_kid: tissues.coding.cell('planner').kid,
          receptor: 'run',
          payload: { patch: 'p' },
          capability: issued.token,
        });
        if (verdict.ok === false && verdict.code === 'NEXA_E_CAP_AUDIENCE') return { blocked: true, code: verdict.code };
        return { blocked: false, detail: { code: verdict.code ?? 'ALLOW' } };
      },
    }),

    createAttack({
      id: 'forge-a-cell-capability',
      category: 'invalid-signature',
      description: 'a capability is minted by a key the receiving cell never trusted',
      run() {
        const { tissues } = buildCodingOrganism({ clock });
        const outsider = createIdentity({ label: 'outsider', seed: SEEDS.outsider });
        const issuer = createIdentity({ label: 'outsider-issuer', seed: SEEDS.evolver });
        const holder = createIdentity({ label: 'coder', kind: 'agent', seed: seedFor('coder') });
        const token = mintCapability({
          issuer,
          subject: holder.kid,
          resource: 'cell:tester',
          actions: ['run'],
          caveats: {
            nbf: formatInstant(T0),
            exp: formatInstant(new Date(T0.getTime() + 60_000)),
            max_uses: 1,
            max_depth: 0,
          },
          constraints: {},
          now: T0,
          note: 'omega:forged',
        });
        const verdict = tissues.coding.cell('tester').receive({
          from: 'outsider',
          from_kid: holder.kid,
          receptor: 'run',
          payload: { patch: 'p' },
          capability: token,
        });
        void outsider;
        if (verdict.ok === false && verdict.code === 'NEXA_E_UNTRUSTED') return { blocked: true, code: verdict.code };
        return { blocked: false, detail: { code: verdict.code ?? 'ALLOW' } };
      },
    }),

    createAttack({
      id: 'smuggle-a-payload-key',
      category: 'tool-confusion',
      description: 'a message carries a field the receptor never declared, hoping the handler reads it',
      run() {
        const operator = createIdentity({ label: 'cellular-attack-operator', seed: '11'.repeat(32) });
        const guarantor = createGuarantor({ operator, clock });
        let ran = 0;
        const ears = createCell({
          name: 'ears',
          identity: createIdentity({ label: 'ears', kind: 'agent', seed: seedFor('ears') }),
          nucleus: { module: 'ears@1', invariants: [] },
          receptors: {
            listen: {
              accepts: ['note'],
              handler: () => {
                ran += 1;
                return { heard: true };
              },
            },
          },
          port: { verify: guarantor.verify, record: guarantor.record },
          clock,
        });
        ears.activate();
        const sender = createIdentity({ label: 'mouth', seed: seedFor('mouth') });
        const token = mintCapability({
          issuer: operator,
          subject: sender.kid,
          resource: 'cell:ears',
          actions: ['listen'],
          caveats: {
            nbf: formatInstant(T0),
            exp: formatInstant(new Date(T0.getTime() + 60_000)),
            max_uses: 1,
            max_depth: 0,
          },
          constraints: {},
          now: T0,
          note: 'omega:listen',
        });
        const verdict = ears.receive({ from: 'mouth', from_kid: sender.kid, receptor: 'listen', payload: { note: 'hi', smuggle: true }, capability: token });
        if (verdict.ok === false && verdict.code === 'OMEGA_E_SCHEMA' && verdict.step === 'type' && ran === 0) {
          return { blocked: true, code: verdict.code, detail: { handler_runs: ran } };
        }
        return { blocked: false, detail: { code: verdict.code ?? 'ALLOW', handler_runs: ran } };
      },
    }),

    createAttack({
      id: 'widen-authority-by-dividing',
      category: 'scope-widening',
      description: 'division hands a child a capability the parent never held',
      run() {
        const { cells } = buildCodingOrganism({ clock });
        try {
          specialize({
            parent: cells.planner,
            children: [
              { name: 'plan.a', capabilities: ['cell:planner:plan'], justify: 'planning only' },
              { name: 'plan.b', capabilities: ['cell:planner:delete'], justify: 'escalation dressed as specialisation' },
            ],
          });
          return { blocked: false, detail: { reason: 'division granted a capability the parent never had' } };
        } catch (cause) {
          if (cause.code === 'OMEGA_E_CELL_AMPLIFY') return { blocked: true, code: cause.code };
          throw cause;
        }
      },
    }),

    createAttack({
      id: 'fuse-into-a-conflict',
      category: 'policy-bypass',
      description: 'two cells that define the same receptor are fused instead of conflicting',
      run() {
        const { cells } = buildCodingOrganism({ clock });
        const twin = { ...cells.coder, name: 'coder.copy', nucleus: { module: 'coder.copy@1', invariants: [] } };
        const plan = planFusion({ left: cells.coder, right: twin });
        const outcome = runFusion({ plan, gate: { verdict: 'PASS' } });
        if (plan.compatible === false && outcome.ok === false && outcome.code === 'OMEGA_E_QUARANTINED') {
          return { blocked: true, code: outcome.code, detail: { conflicts: plan.conflicts.length } };
        }
        return { blocked: false, detail: { compatible: plan.compatible, code: outcome.code ?? 'ALLOW' } };
      },
    }),

    createAttack({
      id: 'wrap-the-kernel-in-a-cell',
      category: 'kernel-self-modification',
      description: 'the capability authority is declared as a cell, so it could be evolved',
      run() {
        try {
          createCell({
            name: 'authority.cell',
            identity: createIdentity({ label: 'authority.cell', seed: seedFor('authority.cell') }),
            nucleus: { module: 'capability-authority@1', invariants: ['none: this is the point'] },
            receptors: {},
            port: { verify: () => ({ ok: false }), record: () => ({ hash: null }) },
            clock,
          });
          return { blocked: false, detail: { reason: 'a kernel module was accepted as a cell' } };
        } catch (cause) {
          if (cause.code === 'OMEGA_E_KERNEL_IMMUTABLE') return { blocked: true, code: cause.code };
          throw cause;
        }
      },
    }),

    createAttack({
      id: 'keep-serving-while-isolated',
      category: 'resource-exhaustion',
      description: 'an isolated cell keeps answering traffic, and a failed check "recovers" it',
      run() {
        const { cells, tissues } = buildCodingOrganism({ clock });
        const coder = cells.coder;
        coder.isolate();
        const refused = tissues.coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: ['x'] } });
        const fakeRecovery = coder.recover({ check: () => false });
        if (refused.code === 'OMEGA_E_ISOLATED' && refused.step === 'identity' && fakeRecovery.recovered === false && coder.state === 'ISOLATED') {
          return { blocked: true, code: refused.code, detail: { state: coder.state } };
        }
        return { blocked: false, detail: { code: refused.code ?? 'ALLOW', state: coder.state, recovered: fakeRecovery.recovered } };
      },
    }),

    createAttack({
      id: 'promote-untrusted-to-evidence',
      category: 'untrusted-to-evidence',
      description: 'an untrusted tool result is promoted straight to evidence',
      run() {
        if (leaky.compiled.ok) return { blocked: false, detail: { reason: 'the module that promotes untrusted data compiled' } };
        const error = leaky.compiled.diagnostics.find((diagnostic) => diagnostic.code === 'OMEGA_E_EVIDENCE_UNTRUSTED');
        if (error === undefined) return { blocked: false, detail: { codes: leaky.compiled.diagnostics.map((diagnostic) => diagnostic.code) } };
        return { blocked: true, code: error.code, detail: { line: error.toJSON().line } };
      },
    }),
  ];
}

/** @returns {object[]} the attack results, executed */
export function runAttackSuite() {
  return runAttacks(attackSuite());
}

/** The gate's `adversarial` stage, built from this suite's results. */
export function adversarialCheck() {
  const attacks = runAttackSuite();
  return { status: attacks.every((attack) => attack.blocked) ? 'PASS' : 'FAIL', detail: { attacks } };
}

// `node tools/omega-attacks.mjs` prints the suite's own result.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reports = runAttackSuite();
  let failed = 0;
  for (const report of reports) {
    if (!report.blocked) failed += 1;
    process.stdout.write(`  ${report.blocked ? 'BLOCKED' : 'FAILED '} ${report.category.padEnd(22)} ${report.id.padEnd(32)} ${report.code ?? ''}\n`);
  }
  process.stdout.write(`\n${reports.length - failed}/${reports.length} attacks blocked\n`);
  process.exit(failed === 0 ? 0 : 1);
}
