/**
 * Lowering to Ω IR.
 *
 * The IR is the analysed module as plain, canonical data: no locations, no class
 * instances, no functions. Two consequences matter:
 *
 *   · `irHash` is stable under reformatting (whitespace is not semantics) and changes
 *     whenever semantics change, which is what a version manifest commits to;
 *   · the runtime never re-parses, never re-resolves and never re-derives a type — it
 *     executes exactly the IR that was hashed and signed.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { GATED_ACTIONS, GATED_RESOURCES, resourceNamespace } from '../../policy/index.js';

export const OMEGA_IR_VERSION = 1;
export const OMEGA_IR_DOMAIN = 'NEXA/omega1 compiled module\u0000';

/** @param {{base: string, secrecy: string, trust: string}} attrs */
const lowerAttrs = (attrs) => ({ base: attrs.base, secrecy: attrs.secrecy, trust: attrs.trust });

/** @param {object} expr @returns {object} */
function lowerExpr(expr) {
  switch (expr.kind) {
    case 'Literal':
      return { kind: 'Literal', type: expr.type, value: expr.value };
    case 'Name':
      return { kind: 'Name', name: expr.name, sealed: expr.sealed === true };
    case 'Call':
      return {
        kind: 'Call',
        path: expr.path,
        resource: expr.resolved?.resource ?? null,
        action: expr.resolved?.action ?? null,
        accepts_secret: expr.resolved?.accepts_secret === true,
        scope_arg: expr.scopeArg ?? null,
        path_resource: expr.isPathResource === true,
        args: (expr.args ?? []).map((arg) => ({
          name: arg.name,
          sealed: arg.sealed === true,
          attrs: lowerAttrs(arg.attrs),
          expr: lowerExpr(arg.expr),
        })),
      };
    case 'Untaint':
      return {
        kind: 'Untaint',
        name: expr.name,
        type: expr.type,
        from: expr.from ?? null,
        resource: expr.resolved?.resource ?? null,
        action: expr.resolved?.action ?? null,
        trust: expr.resolved?.trust ?? null,
        scope_arg: expr.scopeArg ?? null,
        path_resource: expr.isPathResource === true,
        args: (expr.args ?? []).map((arg) => ({
          name: arg.name,
          sealed: arg.sealed === true,
          attrs: lowerAttrs(arg.attrs),
          expr: lowerExpr(arg.expr),
        })),
      };
    case 'Binary':
      return { kind: 'Binary', op: expr.op, left: lowerExpr(expr.left), right: lowerExpr(expr.right) };
    case 'Not':
      return { kind: 'Not', expr: lowerExpr(expr.expr) };
    default:
      return { kind: 'Unknown', source_kind: String(expr.kind) };
  }
}

/**
 * Walk a lowered module and report anything the lowerer could not describe. The runtime
 * must never be the first component to discover that the compiler produced a hole.
 *
 * @param {object} ir
 * @returns {object[]} `{ kind, source_kind }` for every placeholder found
 */
export function findUnlowered(ir) {
  const found = [];
  const visit = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value.kind === 'Unknown') found.push({ kind: 'Unknown', source_kind: value.source_kind });
    for (const item of Object.values(value)) visit(item);
  };
  for (const mission of ir.missions ?? []) {
    visit(mission.statements ?? []);
    visit(mission.calls ?? []);
    visit(mission.preconditions ?? []);
  }
  for (const proposal of ir.proposals ?? []) visit(proposal);
  return found;
}

/** @param {object} statement @returns {object|null} */
function lowerStatement(statement) {
  const base = { kind: statement.kind };
  switch (statement.kind) {
    case 'Let':
      return {
        ...base,
        name: statement.name,
        type: statement.type,
        typeName: statement.typeName,
        attrs: lowerAttrs(statement.attrs),
        expr: lowerExpr(statement.expr),
      };
    case 'Set':
      return { ...base, name: statement.name, attrs: lowerAttrs(statement.attrs), expr: lowerExpr(statement.expr) };
    case 'Do':
      return {
        ...base,
        as: statement.as,
        typeName: statement.typeName,
        attrs: lowerAttrs(statement.attrs),
        resource: statement.resolved.resource,
        action: statement.resolved.action,
        trust: statement.resolved.trust,
        accepts_secret: statement.resolved.accepts_secret,
        scope_arg: statement.call.scopeArg ?? null,
        path_resource: statement.isPathResource === true,
        args: (statement.args ?? []).map((arg) => ({
          name: arg.name,
          sealed: arg.sealed === true,
          attrs: lowerAttrs(arg.attrs),
          expr: lowerExpr(arg.expr),
        })),
      };
    case 'Untaint':
      return {
        ...base,
        name: statement.name,
        type: statement.type,
        from: statement.from,
        attrs: lowerAttrs(statement.attrs),
        resource: statement.resolved.resource,
        action: statement.resolved.action,
        trust: statement.resolved.trust,
        scope_arg: statement.call.scopeArg ?? null,
        args: (statement.args ?? []).map((arg) => ({
          name: arg.name,
          sealed: arg.sealed === true,
          attrs: lowerAttrs(arg.attrs),
          expr: lowerExpr(arg.expr),
        })),
      };
    case 'Seal':
      return { ...base, name: statement.name, typeName: statement.typeName };
    case 'Observe':
      return { ...base, key: statement.key, resource: statement.resolved.resource, action: 'read' };
    case 'Remember':
      return { ...base, name: statement.name, tier: statement.tier, resource: statement.resolved.resource, action: 'store' };
    case 'Recall':
      return { ...base, name: statement.name, tier: statement.tier, resource: statement.resolved.resource, action: 'read' };
    case 'Assert':
      return { ...base, op: statement.op, left: lowerExpr(statement.left), right: lowerExpr(statement.right) };
    case 'AssertType':
      return { ...base, name: statement.name, type: statement.type };
    case 'Evidence':
      return { ...base, claim: statement.claim, from: statement.from, typeName: statement.typeName };
    case 'Emit':
      return { ...base, typeName: statement.typeName, expr: lowerExpr(statement.expr), attrs: lowerAttrs(statement.attrs) };
    case 'If':
      return {
        ...base,
        cond: lowerExpr(statement.cond),
        then: statement.then.map(lowerStatement),
        else: statement.else.map(lowerStatement),
      };
    case 'Fail':
      return { ...base, reason: statement.reason };
    default:
      return null;
  }
}

/** @param {object} module @returns {object} canonical IR */
export function lowerToIr(module) {
  return {
    ir: OMEGA_IR_VERSION,
    module: module.path,
    agents: module.agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      model: agent.model,
      allow: agent.allow.map((entry) => ({ resource: entry.resource, actions: [...entry.actions], origin: entry.origin })),
      deny: agent.deny.map((entry) => ({ resource: entry.resource, actions: [...entry.actions], origin: entry.origin })),
    })),
    servers: module.servers.map((server) => ({ name: server.name, tools: [...server.tools] })),
    instruments: module.instruments.map((instrument) => ({
      name: instrument.name,
      resource: instrument.resource,
      actions: [...instrument.actions],
      trust: instrument.trust,
      accepts_secret: instrument.accepts_secret === true,
      provider: instrument.provider,
    })),
    grants: module.grants.map((grant) => ({
      id: grant.id,
      name: grant.name,
      resource: grant.resource,
      actions: [...grant.actions],
      subject: grant.subject,
      ttl_ms: grant.ttlMs,
      max_calls: grant.maxCalls,
      approval: grant.approval,
    })),
    providers: module.providers.map((provider) => ({
      name: provider.name,
      secret: provider.secret,
      strategy: provider.strategy,
      fallback: [...provider.fallback],
      max_cost: provider.max_cost,
    })),
    policies: module.policies.map((policy) => ({
      name: policy.name,
      rules: policy.rules.map((rule) => ({ effect: rule.effect, resource: rule.resource, actions: [...rule.actions] })),
    })),
    secret_rules: module.secret_rules.map((rule) => ({ effect: rule.effect, resource: rule.resource, sink: rule.sink })),
    // The IR is a wire format and speaks snake_case throughout (`scope_arg`,
    // `max_calls`, `path_resource`). The parser's `maxSteps`/`maxRuntimeMs` are
    // normalised here so that a consumer cannot half-read a budget: before this was
    // fixed, `max_steps` parsed, compiled, and was never enforced.
    limits: {
      ...(module.limits.maxSteps === undefined ? {} : { max_steps: module.limits.maxSteps }),
      ...(module.limits.maxRuntimeMs === undefined ? {} : { max_runtime_ms: module.limits.maxRuntimeMs }),
    },
    missions: module.missions.map((mission) => ({
      name: mission.name,
      agent: mission.agent,
      goal: mission.goal,
      plan: [...mission.plan],
      preconditions: mission.preconditions.map((precondition) => ({ resource: precondition.resource, action: precondition.action })),
      contracts: mission.contracts.map((contract) => contract.claim),
      statements: mission.statements.map(lowerStatement).filter((statement) => statement !== null),
    })),
    proposals: module.proposals.map((proposal) => ({
      module: proposal.module,
      from: proposal.from,
      to: proposal.to,
      hypothesis: proposal.hypothesis,
      expects: proposal.expects.map((expectation) => ({ metric: expectation.metric, op: expectation.op, value: expectation.value })),
    })),
  };
}

/** @param {object} ir @returns {string} sha256 multihash of the canonical IR */
export function irHash(ir) {
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_IR_DOMAIN, 'utf8'),
    canonicalBytes(ir),
  ]));
}

/** @param {object} ir @returns {Buffer} the exact bytes the hash covers */
export function irBytes(ir) {
  return Buffer.concat([Buffer.from(OMEGA_IR_DOMAIN, 'utf8'), canonicalBytes(ir)]);
}

/** @param {string} resource @returns {{gate: string, state: 'CLOSED'}|null} */
export function gateFor(resource, action = null) {
  const namespace = resourceNamespace(resource);
  if (namespace !== null && Object.hasOwn(GATED_RESOURCES, namespace)) {
    return { gate: GATED_RESOURCES[namespace], state: 'CLOSED' };
  }
  if (action !== null && Object.hasOwn(GATED_ACTIONS, action)) {
    return { gate: GATED_ACTIONS[action], state: 'CLOSED' };
  }
  return null;
}

/** @param {object[]} statements @param {object[]} out */
function collectCalls(statements, out) {
  for (const statement of statements) {
    if (statement.kind === 'If') {
      collectCalls(statement.then, out);
      collectCalls(statement.else, out);
      collectExprCalls(statement.cond, out);
      continue;
    }
    if (statement.resource !== undefined && statement.action !== undefined) {
      out.push({
        resource: statement.resource,
        action: statement.action,
        gate: gateFor(statement.resource, statement.action),
        ...(statement.kind === 'Untaint' ? { declassify: true } : {}),
      });
    }
    if (statement.expr !== undefined) collectExprCalls(statement.expr, out);
    if (statement.left !== undefined) collectExprCalls(statement.left, out);
    if (statement.right !== undefined) collectExprCalls(statement.right, out);
    if (statement.args !== undefined) {
      for (const arg of statement.args) collectExprCalls(arg.expr, out);
    }
  }
}

/** @param {object} expr @param {object[]} out */
function collectExprCalls(expr, out) {
  if (expr === null || expr === undefined) return;
  switch (expr.kind) {
    case 'Call':
      out.push({ resource: expr.resource, action: expr.action, gate: gateFor(expr.resource, expr.action) });
      for (const arg of expr.args) collectExprCalls(arg.expr, out);
      return;
    case 'Untaint':
      out.push({ resource: expr.resource, action: expr.action, gate: gateFor(expr.resource, expr.action), declassify: true });
      for (const arg of expr.args) collectExprCalls(arg.expr, out);
      return;
    case 'Binary':
      collectExprCalls(expr.left, out);
      collectExprCalls(expr.right, out);
      return;
    case 'Not':
      collectExprCalls(expr.expr, out);
      return;
    default:
  }
}

/**
 * The authority table: who may do what, what the authority will mint, and which calls
 * the kernel will refuse whatever anyone says. This is the surface `nexa explain`
 * prints, and the honest answer to "what can this module actually do?".
 * @param {object} ir
 * @returns {object}
 */
export function explain(ir) {
  return {
    module: ir.module,
    agents: ir.agents.map((agent) => ({
      name: agent.name,
      role: agent.role,
      model: agent.model === null ? null : `provider.${agent.model}`,
      allows: agent.allow.map((entry) => `${entry.actions.join(',')} on ${entry.resource}`),
      denies: agent.deny.map((entry) => `${entry.actions.join(',')} on ${entry.resource}`),
    })),
    grants: ir.grants.map((grant) => ({
      capability: grant.name,
      resource: grant.resource,
      actions: grant.actions.join(','),
      subject: grant.subject,
      ttl_ms: grant.ttl_ms,
      max_calls: grant.max_calls,
      approval: grant.approval,
    })),
    providers: ir.providers.map((provider) => ({
      name: provider.name,
      secret: provider.secret,
      strategy: provider.strategy,
      fallback: provider.fallback,
      max_cost: provider.max_cost,
    })),
    missions: ir.missions.map((mission) => {
      const calls = [];
      collectCalls(mission.statements, calls);
      return {
        name: mission.name,
        agent: mission.agent,
        goal: mission.goal,
        plan: mission.plan,
        preconditions: mission.preconditions.map((precondition) => `${precondition.action} on ${precondition.resource}`),
        contracts: mission.contracts,
        calls,
      };
    }),
    evolution: ir.proposals.map((proposal) => ({
      module: proposal.module,
      from: proposal.from,
      to: proposal.to,
      hypothesis: proposal.hypothesis,
      expects: proposal.expects.map((expectation) => `${expectation.metric} ${expectation.op} ${expectation.value}`),
    })),
  };
}
