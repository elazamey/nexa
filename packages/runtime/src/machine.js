/**
 * The mission machine.
 *
 * Executes Ω IR. Every statement is deterministic given the injected clock, world,
 * memory and providers; every call goes authority → capability → kernel → receipt; and
 * every step that matters writes an Ω record. The runtime holds no keys and no
 * permission: the only way it can produce an effect is by being *allowed* to.
 *
 * Failure is a first-class outcome: a mission ends in VERDICT ALLOW or VERDICT DENY,
 * both recorded, both hash-linked to the evidence that justified them.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { OmegaLedger } from './ledger.js';

/** Internal control-flow signal: a mission stopped for a recorded reason. */
class MissionStop extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'MissionStop';
    this.code = code;
    this.detail = detail;
  }
}

/** @param {unknown} value @returns {string} */
function digestOf(value) {
  return sha256Multihash(canonicalBytes(value ?? {}));
}

/** @param {unknown} left @param {unknown} right @param {string} op */
function compare(left, right, op) {
  if (op === '==') return digestOf(left) === digestOf(right);
  if (op === '!=') return digestOf(left) !== digestOf(right);
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new MissionStop('OMEGA_E_ASSERT', `only numbers can be compared with ${op}`);
  }
  switch (op) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    default: throw new MissionStop('OMEGA_E_ASSERT', `unknown comparison ${op}`);
  }
}

class MissionRun {
  constructor({ runtime, mission, ledger }) {
    this.runtime = runtime;
    this.mission = mission;
    this.ledger = ledger;
    this.env = new Map();
    this.step = 0;
    this.startedAt = runtime.clock().getTime();
    this.fulfilled = new Set();
    this.receipts = [];
    this.result = null;
    this.plan = { declared: mission.plan, effective: [...mission.plan], planner: runtime.planner === null ? 'absent' : 'answered' };
    this.recordsBefore = ledger.length;
  }

  /** @param {object} input */
  #record(input) {
    return this.ledger.append({ mission: this.mission.name, step: this.step, ...input });
  }

  /** @param {string} code @param {string} message @param {object} [detail] */
  #stop(code, message, detail = {}) {
    throw new MissionStop(code, message, detail);
  }

  #checkBudget() {
    const limits = this.runtime.ir.limits ?? {};
    // Tolerant of both spellings: an IR produced before the normalisation still gets
    // its budget enforced, because a budget that is read under the wrong name is a
    // budget that does not exist.
    const maxSteps = limits.max_steps ?? limits.maxSteps;
    const maxRuntimeMs = limits.max_runtime_ms ?? limits.maxRuntimeMs;
    this.step += 1;
    if (maxSteps !== undefined && this.step > maxSteps) {
      this.#record({ kind: 'VERDICT', decision: 'DENY', detail: { code: 'OMEGA_E_BUDGET', limit: maxSteps, observed: this.step } });
      this.#stop('OMEGA_E_BUDGET', `the mission exceeded max_steps (${maxSteps})`, { limit: maxSteps });
    }
    if (maxRuntimeMs !== undefined) {
      const elapsed = this.runtime.clock().getTime() - this.startedAt;
      if (elapsed > maxRuntimeMs) {
        this.#record({ kind: 'VERDICT', decision: 'DENY', detail: { code: 'OMEGA_E_BUDGET', limit_ms: maxRuntimeMs, observed_ms: elapsed } });
        this.#stop('OMEGA_E_BUDGET', `the mission exceeded max_runtime (${maxRuntimeMs}ms)`, { limit_ms: maxRuntimeMs });
      }
    }
  }

  /**
   * Ask the healer what a failure means, and record its answer. The healer advises —
   * it cannot issue a capability, cannot open a gate and cannot continue a mission — so
   * its advice is evidence, not authority.
   * @param {string} resource @param {string|null} code @param {string} action
   */
  #heal(resource, code, action) {
    const healer = this.runtime.healer ?? null;
    if (healer === null) return;
    const event = healer.observe({ resource, code, step: this.step });
    this.#record({
      kind: 'HEAL',
      decision: 'INFO',
      resource,
      action,
      detail: event,
    });
  }

  /** The authority answers first; the kernel decides; both are recorded. */
  #invoke({ resource, action, args, accepts_secret = false }, { declassify = false } = {}) {
    const agentName = this.mission.agent;
    const actor = this.runtime.kernel.agent(agentName);

    const breakerState = this.runtime.breaker.check(resource);
    if (breakerState.open) {
      this.#record({
        kind: 'CIRCUIT_OPEN',
        decision: 'DENY',
        resource,
        action,
        detail: { failures: breakerState.failures, cooldown_remaining_ms: breakerState.cooldown_remaining_ms },
      });
      this.#heal(resource, 'OMEGA_E_CIRCUIT_OPEN', action);
      this.#stop('OMEGA_E_CIRCUIT_OPEN', `${resource} is isolated after ${breakerState.failures} consecutive failures`, { resource });
    }

    let issued;
    try {
      issued = this.runtime.authority.issue({ agent: agentName, agentKid: actor.kid, resource, action, args });
    } catch (cause) {
      const error = cause instanceof OmegaError ? cause : new OmegaError('OMEGA_E_GRANT_MISSING', String(cause));
      this.#record({
        kind: 'TOOL_CALL',
        decision: 'DENY',
        resource,
        action,
        detail: { code: error.code, reason: error.message },
      });
      this.#stop(error.code, error.message, { resource, action });
      throw error; // unreachable
    }

    this.#record({
      kind: 'TOOL_CALL',
      decision: 'INFO',
      resource,
      action,
      capability: issued.token.id,
      detail: { grant: issued.grant.name, expires: issued.expires, args_digest: digestOf(args), accepts_secret },
    });

    const envelope = actor.endpoint.call({ to: this.runtime.kernel.endpoint.kid, resource, action, args, capability: issued.token });
    const outcome = this.runtime.kernel.endpoint.receive(envelope);
    const kernelRecord = outcome.record ?? null;
    const receipt = outcome.receipt ?? null;
    if (receipt !== null) this.receipts.push(receipt);

    const allowed = outcome.decision === 'ALLOW';
    this.runtime.breaker.record(resource, allowed);
    if (!allowed) this.#heal(resource, outcome.code ?? null, action);

    this.#record({
      kind: 'TOOL_RESULT',
      decision: allowed ? 'ALLOW' : 'DENY',
      resource,
      action,
      capability: issued.token.id,
      subject: actor.kid,
      detail: {
        kernel_decision: outcome.decision,
        code: outcome.code ?? null,
        kernel_hash: kernelRecord?.hash ?? null,
        receipt: receipt?.id ?? null,
        value_hash: allowed ? digestOf(outcome.value) : null,
      },
    });

    if (outcome.code === 'NEXA_E_GATE') {
      const gate = outcome.reply?.body?.details?.gate ?? outcome.record?.detail?.gate ?? 'UNKNOWN';
      this.#record({
        kind: 'GATE_REFUSAL',
        decision: 'DENY',
        resource,
        action,
        detail: { gate, state: 'CLOSED', kernel_code: 'NEXA_E_GATE' },
      });
      this.#stop('NEXA_E_GATE', `the ${gate} gate is closed: ${resource} ${action} is refused by the kernel`, { gate, resource });
    }

    if (!allowed) {
      this.#stop(outcome.code ?? 'OMEGA_E_FAILED', `the kernel refused ${action} on ${resource}`, {
        resource,
        action,
        kernel_code: outcome.code ?? null,
      });
    }

    if (declassify) {
      this.#record({
        kind: 'DECLASSIFY',
        decision: 'INFO',
        resource,
        action,
        capability: issued.token.id,
        detail: { via: resource, receipt: receipt?.id ?? null },
      });
    }

    return outcome.value;
  }

  /** @param {object} spec a lowered Call/Untaint node @returns {object} */
  #evalArgs(spec) {
    const args = {};
    const lowered = spec.args ?? [];
    lowered.forEach((arg, index) => {
      const sealed = arg.sealed === true;
      if (sealed && spec.accepts_secret !== true) {
        this.#stop('OMEGA_E_SEALED_MISUSE', 'a sealed value may only be passed to an instrument that accepts secrets');
      }
      const value = this.#evalExpr(arg.expr, { secretOk: spec.accepts_secret === true });
      if (arg.name === null) args[`arg${index}`] = value;
      else args[arg.name] = value;
    });
    if (spec.path_resource === true && spec.scope_arg !== null && spec.scope_arg !== undefined && args.path === undefined) {
      args.path = spec.scope_arg;
    }
    canonicalBytes(args); // an argument the ledger could not commit to never leaves
    return args;
  }

  /** @param {object} spec @returns {object} */
  #call(spec) {
    const args = this.#evalArgs(spec);
    const value = this.#invoke(
      {
        resource: spec.resource,
        action: spec.action,
        args,
        accepts_secret: spec.accepts_secret === true,
      },
      { declassify: spec.kind === 'Untaint' },
    );
    return value;
  }

  /** @param {object} expr @param {{secretOk?: boolean}} [options] */
  #evalExpr(expr, { secretOk = false } = {}) {
    switch (expr.kind) {
      case 'Literal':
        return expr.value;
      case 'Name': {
        const binding = this.env.get(expr.name);
        if (binding === undefined) this.#stop('OMEGA_E_UNBOUND', `${expr.name} is not bound`);
        if (binding.sealed === true && !secretOk) {
          this.#stop('OMEGA_E_SEALED_MISUSE', `${expr.name} is sealed and may only enter an instrument that accepts secrets`);
        }
        return binding.value;
      }
      case 'Binary': {
        const left = this.#evalExpr(expr.left, { secretOk });
        const right = this.#evalExpr(expr.right, { secretOk });
        if (expr.op === 'and') return Boolean(left) && Boolean(right);
        if (expr.op === 'or') return Boolean(left) || Boolean(right);
        if (expr.op === '+') return Number(left) + Number(right);
        if (expr.op === '-') return Number(left) - Number(right);
        return compare(left, right, expr.op);
      }
      case 'Not':
        return !this.#evalExpr(expr.expr, { secretOk });
      case 'Call':
      case 'Untaint':
        return this.#call(expr);
      default:
        this.#stop('OMEGA_E_SCHEMA', `unknown expression kind ${String(expr.kind)}`);
        return null;
    }
  }

  /** @param {object[]} statements */
  #runStatements(statements) {
    for (const statement of statements) {
      this.#checkBudget();
      this.#runStatement(statement);
    }
  }

  /** @param {object} statement */
  #runStatement(statement) {
    switch (statement.kind) {
      case 'Let': {
        const value = this.#evalExpr(statement.expr);
        this.env.set(statement.name, {
          value,
          attrs: statement.attrs,
          sealed: false,
          typeName: statement.typeName,
        });
        return;
      }
      case 'Set': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) this.#stop('OMEGA_E_UNBOUND', `set ${statement.name}: no such binding`);
        if (binding.sealed === true) this.#stop('OMEGA_E_SEALED_MISUSE', `${statement.name} is sealed`);
        binding.value = this.#evalExpr(statement.expr);
        return;
      }
      case 'Do': {
        const value = this.#call(statement);
        if (statement.as !== null) {
          this.env.set(statement.as, { value, attrs: statement.attrs, sealed: false, typeName: statement.typeName });
        }
        return;
      }
      case 'Observe': {
        const observed = this.#invoke({ resource: statement.resource, action: 'read', args: { key: statement.key } });
        this.#record({
          kind: 'OBSERVATION',
          decision: 'INFO',
          resource: statement.resource,
          action: 'read',
          trust: 'observed',
          detail: { key: observed?.key ?? statement.key, digest: observed?.digest ?? null },
        });
        return;
      }
      case 'Remember': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) this.#stop('OMEGA_E_UNBOUND', `remember ${statement.name}: no such binding`);
        if (binding.attrs?.secrecy !== 'public') {
          this.#stop('OMEGA_E_SECRET_EGRESS', `${statement.name} is not public and cannot be remembered`);
        }
        const valueHash = digestOf(binding.value);
        const stored = this.#invoke({
          resource: statement.resource,
          action: 'store',
          args: {
            name: statement.name,
            value_hash: valueHash,
            value_type: binding.typeName ?? 'unknown',
            mission: this.mission.name,
          },
        });
        this.#record({
          kind: 'MEMORY_WRITE',
          decision: 'INFO',
          resource: statement.resource,
          action: 'store',
          trust: 'internal',
          detail: { name: statement.name, value_hash: valueHash, tier_entries: stored?.entries ?? null },
        });
        return;
      }
      case 'Recall': {
        const reference = this.#invoke({ resource: statement.resource, action: 'read', args: { tier: statement.tier } });
        this.env.set(statement.name, { value: reference, attrs: statement.attrs, sealed: false, typeName: 'MemoryRef' });
        this.#record({
          kind: 'MEMORY_READ',
          decision: 'INFO',
          resource: statement.resource,
          action: 'read',
          trust: 'internal',
          detail: { tier: statement.tier, entries: reference?.entries ?? null, digest: reference?.digest ?? null },
        });
        return;
      }
      case 'Seal': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) this.#stop('OMEGA_E_UNBOUND', `seal ${statement.name}: no such binding`);
        binding.sealed = true;
        this.#record({
          kind: 'SEAL',
          decision: 'INFO',
          subject: this.runtime.kernel.agent(this.mission.agent).kid,
          trust: 'secret',
          detail: { name: statement.name, type: binding.typeName ?? 'unknown', value_hash: digestOf(binding.value) },
        });
        return;
      }
      case 'Assert': {
        const left = this.#evalExpr(statement.left);
        const right = this.#evalExpr(statement.right);
        const ok = compare(left, right, statement.op);
        this.#record({
          kind: 'ASSERT',
          decision: ok ? 'INFO' : 'DENY',
          detail: { op: statement.op, left_hash: digestOf(left), right_hash: digestOf(right), ok },
        });
        if (!ok) this.#stop('OMEGA_E_ASSERT', `an assertion failed at run time (${statement.op})`, { op: statement.op });
        return;
      }
      case 'AssertType': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) this.#stop('OMEGA_E_UNBOUND', `assert ${statement.name}: no such binding`);
        this.#record({
          kind: 'ASSERT',
          decision: 'INFO',
          detail: { name: statement.name, is: statement.type, actual: binding.typeName ?? 'unknown' },
        });
        return;
      }
      case 'Evidence': {
        const binding = this.env.get(statement.from);
        if (binding === undefined) this.#stop('OMEGA_E_UNBOUND', `evidence claim "${statement.claim}" cites unbound ${statement.from}`);
        this.fulfilled.add(statement.claim);
        this.#record({
          kind: 'EVIDENCE',
          decision: 'ALLOW',
          claim: statement.claim,
          trust: binding.attrs?.trust ?? 'unknown',
          detail: { from: statement.from, value_hash: digestOf(binding.value), type: binding.typeName ?? 'unknown' },
        });
        return;
      }
      case 'Emit': {
        const value = this.#evalExpr(statement.expr);
        this.result = { value, typeName: statement.typeName ?? 'unknown', hash: digestOf(value) };
        return;
      }
      case 'If': {
        const condition = this.#evalExpr(statement.cond);
        const branch = condition ? statement.then : statement.else;
        this.#record({ kind: 'PLAN', decision: 'INFO', detail: { branch: condition ? 'then' : 'else', step: this.step } });
        this.#runStatements(branch);
        return;
      }
      case 'Fail': {
        this.#stop('OMEGA_E_FAILED', statement.reason);
        return;
      }
      default:
        this.#stop('OMEGA_E_SCHEMA', `unknown statement kind ${String(statement.kind)}`);
    }
  }

  #start() {
    const actor = this.runtime.kernel.agent(this.mission.agent);
    this.#record({
      kind: 'MISSION_START',
      decision: 'INFO',
      subject: actor.kid,
      detail: {
        goal: this.mission.goal,
        agent: this.mission.agent,
        module_hash: this.runtime.moduleHash,
        preconditions: this.mission.preconditions.map((precondition) => `${precondition.action} on ${precondition.resource}`),
        contracts: this.mission.contracts,
      },
    });

    if (this.runtime.planner !== null) {
      const answer = this.runtime.planner({
        mission: this.mission.name,
        agent: this.mission.agent,
        goal: this.mission.goal,
        plan: this.mission.plan,
        preconditions: this.mission.preconditions,
        world: this.runtime.kernel.world.summary(),
        memory: this.runtime.kernel.memory.summary(),
      });
      if (answer?.refuse !== undefined) {
        this.#record({ kind: 'PLAN', decision: 'DENY', detail: { planner: 'refused', reason: String(answer.refuse) } });
        this.#stop('OMEGA_E_PLANNER_REFUSED', `the planner refused the plan: ${String(answer.refuse)}`);
      }
      if (Array.isArray(answer?.plan)) {
        this.plan.effective = answer.plan.map((step) => String(step));
        this.plan.planner = 'annotated';
      }
    }

    this.#record({
      kind: 'PLAN',
      decision: 'INFO',
      detail: {
        declared: this.plan.declared,
        effective: this.plan.effective,
        planner: this.plan.planner,
        note: 'a plan is intent: it cannot add a capability or a statement',
      },
    });

    for (const precondition of this.mission.preconditions) {
      const verdict = this.runtime.authority.canIssue({
        agent: this.mission.agent,
        resource: precondition.resource,
        action: precondition.action,
      });
      if (!verdict.ok) {
        this.#record({
          kind: 'VERDICT',
          decision: 'DENY',
          resource: precondition.resource,
          action: precondition.action,
          detail: { code: verdict.code, reason: verdict.reason, phase: 'precondition' },
        });
        this.#stop(verdict.code, verdict.reason, { resource: precondition.resource, action: precondition.action });
      }
    }
  }

  /** @param {'ALLOW'|'DENY'} decision @param {string|null} code @param {string|null} message */
  #verdict(decision, code, message, detail = {}) {
    if (code === 'OMEGA_E_CONTRACT_UNMET') {
      this.#record({
        kind: 'CONTRACT_UNMET',
        decision: 'DENY',
        detail: { missing: detail.missing ?? [], contracts: this.mission.contracts },
      });
    }
    this.#record({
      kind: 'VERDICT',
      decision,
      detail: decision === 'ALLOW'
        ? {
          contracts: this.mission.contracts.length,
          fulfilled: [...this.fulfilled].sort(),
          result_hash: this.result?.hash ?? null,
          steps: this.step,
        }
        : { code, reason: message, ...detail },
    });
    const records = this.ledger.entries().slice(this.recordsBefore);
    this.#record({
      kind: 'MISSION_END',
      decision: decision === 'ALLOW' ? 'ALLOW' : 'DENY',
      detail: {
        steps: this.step,
        records: this.ledger.length - this.recordsBefore,
        elapsed_ms: this.runtime.clock().getTime() - this.startedAt,
      },
    });
    return {
      status: decision,
      code: code ?? null,
      message: message ?? null,
      mission: this.mission.name,
      agent: this.mission.agent,
      plan: this.plan,
      value: decision === 'ALLOW' ? (this.result?.value ?? null) : null,
      result: this.result,
      steps: this.step,
      records,
      ledger: this.ledger,
      receipts: this.receipts,
      contracts: this.mission.contracts.map((claim) => ({ claim, ok: this.fulfilled.has(claim) })),
      memory: this.runtime.kernel.memory.summary(),
    };
  }

  execute() {
    try {
      this.#start();
      this.#runStatements(this.mission.statements);
      const missing = this.mission.contracts.filter((claim) => !this.fulfilled.has(claim));
      if (missing.length > 0) {
        this.#stop('OMEGA_E_CONTRACT_UNMET', `the mission produced no evidence for: ${missing.join(', ')}`, { missing });
      }
      return this.#verdict('ALLOW', null, null);
    } catch (cause) {
      const stop = cause instanceof MissionStop
        ? cause
        : new MissionStop(cause instanceof OmegaError ? cause.code : 'OMEGA_E_FAILED', cause instanceof Error ? cause.message : String(cause));
      return this.#verdict('DENY', stop.code, stop.message, stop.detail);
    }
  }
}

export class Runtime {
  /**
   * @param {object} input
   * @param {object} input.ir compiled Ω IR
   * @param {object} input.kernel the kernel host (`createKernel`)
   * @param {object} input.authority the authority (`Authority`)
   * @param {() => Date} [input.clock]
   * @param {Function|null} [input.planner] optional planner port
   * @param {object} [input.breaker] circuit breaker
   * @param {string|null} [input.moduleHash]
   */
  constructor({ ir, kernel, authority, clock = () => new Date(), planner = null, breaker = null, healer = null, moduleHash = null }) {
    if (ir === undefined || ir.ir !== 1) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'the runtime needs compiled Ω IR (version 1)');
    }
    if (kernel === undefined || authority === undefined) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'the runtime needs a kernel host and an authority');
    }
    this.ir = ir;
    this.kernel = kernel;
    this.authority = authority;
    this.clock = clock;
    this.planner = planner;
    this.breaker = breaker;
    this.healer = healer;
    this.moduleHash = moduleHash;
    this.runs = [];
  }

  /** @param {string} name @returns {object} */
  mission(name) {
    const found = this.ir.missions.find((entry) => entry.name === name);
    if (found === undefined) {
      throw new OmegaError('OMEGA_E_NO_MISSION', `the module has no mission named ${name}`, {
        missions: this.ir.missions.map((entry) => entry.name).sort(),
      });
    }
    return found;
  }

  /**
   * @param {string} missionName
   * @param {{ledger?: object}} [options]
   * @returns {object} the outcome (see `MissionRun#verdict`)
   */
  run(missionName, { ledger = null } = {}) {
    const mission = this.mission(missionName);
    const actor = this.kernel.agent(mission.agent);
    const activeLedger = ledger ?? new OmegaLedger({ actor, clock: this.clock, module: this.moduleHash ?? this.ir.module });
    const run = new MissionRun({ runtime: this, mission, ledger: activeLedger });
    const outcome = run.execute();
    this.runs.push({ mission: missionName, status: outcome.status, code: outcome.code, steps: outcome.steps });
    return outcome;
  }

  /** @returns {object} */
  describe() {
    return {
      module: this.ir.module,
      module_hash: this.moduleHash,
      missions: this.ir.missions.map((mission) => ({
        name: mission.name,
        agent: mission.agent,
        contracts: mission.contracts,
        preconditions: mission.preconditions.map((precondition) => `${precondition.action} on ${precondition.resource}`),
      })),
      limits: { ...this.ir.limits },
      grants: this.authority.usage(),
      kernel: this.kernel.describe(),
      breaker: this.breaker === null ? [] : this.breaker.snapshot(),
      healer: this.healer === null ? null : this.healer.describe(),
      runs: [...this.runs],
    };
  }
}
