/**
 * The Ω analyser.
 *
 * Everything a module claims is checked here, before a single kernel call happens:
 *
 *   · every capref resolves (call sites, allow-lists, grants, policies);
 *   · every call site is covered by the acting agent's allow-list, with `deny` winning;
 *   · every value flowing into a sink satisfies that sink's secrecy and trust rules;
 *   · every memory/world/sanitizer/model access is itself a capability-gated call;
 *   · every `require evidence` contract has a statement that can satisfy it;
 *   · declassification names a sanitizer that the module declares as verified.
 *
 * The output is a *linked module*: the AST with resolution and type attributes filled
 * in. It is pure data — no authority, no clock, no I/O — which is what makes it safe to
 * hash, sign, store and diff.
 */
import { Diagnostic, hasErrors, OmegaError } from './errors.js';
import {
  BUILTIN_NAMESPACES,
  coversCall,
  isConcreteResource,
  isResource,
  namespaceOf,
  resolveCapref,
} from './caprefs.js';
import {
  TYPE_TABLE,
  assignable,
  checkSink,
  describeAttrs,
  isKnownType,
  isSecret,
  joinAttrs,
  typeAttrs,
} from './security-types.js';
import { MEMORY_TIERS } from './parser.js';

/**
 * Where a namespace's scope comes from at a call site: `fs.read("/x")` names a path,
 * `model.invoke(provider: "gemini")` names a provider. Everything else is either
 * scoped by an explicit `scope:`/`path:` argument or has no scope at all.
 */
export const LOCATOR_ARGUMENTS = Object.freeze({
  fs: 'path',
  net: 'path',
  model: 'provider',
});

/** Fixed sink names that map onto a resource pattern. */
export const SINK_RESOURCES = Object.freeze({
  network: 'net:*',
  filesystem: 'fs:*',
  evidence: 'evidence:*',
  memory: 'memory:*',
  world: 'world:*',
  prompt: 'model:*',
  logs: 'logs:*',
  emit: 'emit',
});

const SEALED_MISUSE = 'OMEGA_E_SEALED_MISUSE';

/**
 * First matching rule wins; no rule means no secret leaves. Used both by the analyser
 * (compile time) and by the runtime (before a call is attempted).
 * @param {{effect: string, resource: string}[]} secretRules
 * @param {string} resource
 * @returns {boolean}
 */
export function secretEgressAllows(secretRules, resource) {
  if (!Array.isArray(secretRules)) return false;
  for (const rule of secretRules) {
    if (rule.resource === resource) {
      return rule.effect === 'ALLOW';
    }
    if (rule.resource.includes('*') && matchesPattern(rule.resource, resource)) {
      return rule.effect === 'ALLOW';
    }
  }
  return false;
}

/** @param {string} pattern @param {string} value */
function matchesPattern(pattern, value) {
  const colon = pattern.indexOf(':');
  if (colon === -1) return pattern === value;
  const namespace = pattern.slice(0, colon);
  if (!value.startsWith(`${namespace}:`)) return false;
  const scope = pattern.slice(colon + 1);
  if (!scope.includes('*')) return scope === value.slice(colon + 1);
  const source = scope
    .split('**')
    .map((part) => part.split('*').map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('[\\s\\S]*');
  return new RegExp(`^${source}$`, 'u').test(value.slice(colon + 1));
}

class Analyzer {
  constructor(program, { path }) {
    this.program = program;
    this.path = path;
    this.diagnostics = [];
    this.instruments = new Map();
    this.servers = new Map();
    this.agents = new Map();
    this.providers = new Map();
    this.missions = new Map();
    this.grants = [];
    this.policies = [];
    this.secretRules = [];
    this.limits = {};
    this.proposals = [];
    this.module = null;
  }

  /** @param {string} code @param {string} message @param {object|null} loc */
  report(code, message, loc = null, details = undefined) {
    this.diagnostics.push(new Diagnostic({ code, message, loc, details }));
  }

  collect() {
    for (const declaration of this.program.declarations) {
      const { kind } = declaration;
      if (kind === 'Policy' || kind === 'Grant' || kind === 'Evolve') continue; // resolved later
      const table = {
        Agent: this.agents,
        Mcp: this.servers,
        Instrument: this.instruments,
        Provider: this.providers,
        Mission: this.missions,
      }[kind];
      if (table === undefined) continue;
      const label = { Agent: 'agent', Mcp: 'mcp server', Instrument: 'instrument', Provider: 'provider', Mission: 'mission' }[kind];
      if (table.has(declaration.name)) {
        this.report('OMEGA_E_DUPLICATE', `${label} ${declaration.name} is declared twice`, declaration.loc);
        continue;
      }
      table.set(declaration.name, declaration);
    }
  }

  /** @param {object} declaration @returns {object} the resolved instrument */
  resolveInstrument(declaration) {
    const resolved = {
      name: declaration.name,
      resource: declaration.resource,
      actions: declaration.actions,
      trust: declaration.trust,
      accepts_secret: declaration.acceptsSecret === true,
      provider: declaration.provider,
      loc: declaration.loc,
    };
    if (!isConcreteResource(declaration.resource)) {
      this.report(
        'OMEGA_E_SCHEMA',
        `instrument ${declaration.name} binds to ${JSON.stringify(declaration.resource)}, which is not a concrete resource id like "tool:echo"`,
        declaration.loc,
      );
      resolved.invalid = true;
    }
    for (const action of declaration.actions) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(action)) {
        this.report('OMEGA_E_SCHEMA', `instrument ${declaration.name} declares an invalid action ${JSON.stringify(action)}`, declaration.loc);
        resolved.invalid = true;
      }
    }
    return resolved;
  }

  resolveCaprefNode(capref, { pattern = false, where = 'capability reference' } = {}) {
    try {
      return resolveCapref({ instruments: this.instruments, servers: this.servers }, capref, { pattern });
    } catch (cause) {
      const error = cause instanceof OmegaError ? cause : new OmegaError('OMEGA_E_SCHEMA', String(cause));
      const loc = capref.loc ?? { line: error.details?.line ?? 0, column: error.details?.column ?? 0 };
      this.report(error.code, `${where} ${capref.path ?? capref.resource}: ${error.message}`, loc, error.details);
      return null;
    }
  }

  /** A provider's `secret` must be a handle. A literal key is a compile-time refusal. */
  resolveProviders() {
    for (const provider of this.providers.values()) {
      const secret = provider.secret;
      if (typeof secret !== 'string' || !/^(vault|kms|envelope):\/\/[a-z0-9][a-z0-9._-]{0,63}$/.test(secret)) {
        this.report(
          'OMEGA_E_SECRET_LITERAL',
          `provider ${provider.name} must name a handle (vault://name, kms://name, envelope://name); the source contains ${JSON.stringify(String(secret).slice(0, 12))}…`,
          provider.secretLoc ?? provider.loc,
        );
      }
    }
  }

  resolveAgents() {
    for (const agent of this.agents.values()) {
      const allow = [];
      const deny = [];
      for (const capref of agent.allow) {
        const resolved = this.resolveCaprefNode(capref, { pattern: true, where: `allow entry in agent ${agent.name}` });
        if (resolved !== null) allow.push({ ...resolved, capref, uses: 0 });
      }
      for (const capref of agent.deny) {
        const resolved = this.resolveCaprefNode(capref, { pattern: true, where: `deny entry in agent ${agent.name}` });
        if (resolved !== null) deny.push({ ...resolved, capref });
      }
      agent.resolvedAllow = allow;
      agent.resolvedDeny = deny;
      if (agent.model !== null && agent.model !== 'auto' && !this.providers.has(agent.model)) {
        this.report(
          'OMEGA_E_UNKNOWN_PROVIDER',
          `agent ${agent.name} names provider.${agent.model}, which the module does not declare`,
          agent.modelLoc ?? agent.loc,
          { declared: [...this.providers.keys()].sort() },
        );
      }
    }
  }

  resolveGrants() {
    const seen = new Set();
    this.program.declarations.forEach((declaration, index) => {
      if (declaration.kind !== 'Grant') return;
      // A grant may name its scope either in the capref (`grant fs.write("/build/**")`)
      // or as a field (`grant fs.write { scope "/build/**" }`); both mean the same thing.
      const capref = declaration.scope === null
        ? declaration.capref
        : { ...declaration.capref, scope: declaration.capref.scope ?? declaration.scope };
      const resolved = this.resolveCaprefNode(capref, { pattern: true, where: 'grant' });
      if (resolved === null) return;
      const scope = declaration.capref.scope ?? declaration.scope;
      let resource = resolved.resource;
      const namespace = namespaceOf(resource);
      const builtin = BUILTIN_NAMESPACES[namespace];
      if (resolved.origin === 'builtin' && builtin !== undefined && builtin.path) {
        if (scope === null || scope === undefined) {
          this.report('OMEGA_E_SCHEMA', `grant ${declaration.name} must give a scope for ${namespace} (e.g. scope "/src/**")`, declaration.loc);
          return;
        }
        resource = `${namespace}:${scope}`;
      } else if (resolved.origin === 'builtin' && scope !== null && scope !== undefined) {
        resource = `${namespace}:${scope}`;
      } else if (scope !== null && scope !== undefined && resolved.origin !== 'builtin') {
        this.report('OMEGA_E_SCHEMA', `grant ${declaration.name} takes no scope: ${declaration.name} is not a path namespace`, declaration.loc);
        return;
      }
      if (!isResource(resource)) {
        this.report('OMEGA_E_SCHEMA', `grant ${declaration.name} produced an invalid resource: ${resource}`, declaration.loc);
        return;
      }
      const subject = declaration.subject;
      if (subject !== 'any' && !this.agents.has(subject)) {
        this.report('OMEGA_E_SCHEMA', `grant ${declaration.name} names subject ${subject}, which is not a declared agent`, declaration.loc, {
          agents: [...this.agents.keys()].sort(),
        });
        return;
      }
      const key = `${resource}|${resolved.actions.join(',')}|${subject}`;
      if (seen.has(key)) {
        this.report('OMEGA_E_DUPLICATE', `grant ${declaration.name} duplicates another grant for ${resource} (${subject})`, declaration.loc);
        return;
      }
      seen.add(key);
      this.grants.push({
        id: `grant-${String(index).padStart(3, '0')}`,
        name: declaration.name,
        resource,
        actions: resolved.actions,
        subject,
        ttlMs: declaration.ttlMs,
        maxCalls: declaration.maxCalls,
        approval: declaration.approval,
        requiresApproval: declaration.approval !== null,
        loc: declaration.loc,
      });
    });
  }

  resolvePolicies() {
    for (const policy of this.program.declarations) {
      if (policy.kind !== 'Policy') continue;
      const rules = [];
      for (const rule of policy.rules) {
        const resolved = this.resolveCaprefNode(rule.capref, { pattern: true, where: `rule in policy ${policy.name}` });
        if (resolved === null) continue;
        rules.push({ effect: rule.effect, resource: resolved.resource, actions: resolved.actions, ref: rule.capref.path });
      }
      this.policies.push({ name: policy.name, rules, limits: policy.limits, loc: policy.loc });
      if (policy.limits.maxSteps !== undefined) this.limits.maxSteps = policy.limits.maxSteps;
      if (policy.limits.maxRuntimeMs !== undefined) this.limits.maxRuntimeMs = policy.limits.maxRuntimeMs;
      for (const secretRule of policy.secretRules) {
        const resource = this.resolveSink(secretRule.sink, policy.name, secretRule.loc);
        if (resource === null) continue;
        this.secretRules.push({ effect: secretRule.effect, resource, sink: secretRule.sink, policy: policy.name });
      }
    }
  }

  /** @param {string} sink @returns {string|null} */
  resolveSink(sink, policyName, loc) {
    if (Object.hasOwn(SINK_RESOURCES, sink)) return SINK_RESOURCES[sink];
    if (sink.startsWith('provider.')) {
      const provider = sink.slice('provider.'.length);
      if (provider !== 'auto' && !this.providers.has(provider)) {
        this.report('OMEGA_E_UNKNOWN_PROVIDER', `policy ${policyName} names provider.${provider}, which the module does not declare`, loc, {
          declared: [...this.providers.keys()].sort(),
        });
        return null;
      }
      return `model:${provider}`;
    }
    const resolved = this.resolveCaprefNode({ kind: 'CapRef', path: sink, loc }, { pattern: true, where: `secret egress rule in policy ${policyName}` });
    return resolved === null ? null : resolved.resource;
  }

  /** The acting agent must cover this (resource, action), and `deny` wins. */
  requireCapability(agent, resource, action, loc, { context = 'call' } = {}) {
    if (agent === null) return false;
    const required = { resource, actions: [action] };
    for (const deny of agent.resolvedDeny) {
      if (coversCall(deny, required).ok) {
        this.report('OMEGA_E_CAP_MISSING', `agent ${agent.name} explicitly denies ${action} on ${resource}`, loc, {
          agent: agent.name,
          resource,
          action,
          context,
        });
        return false;
      }
    }
    for (const allow of agent.resolvedAllow) {
      if (coversCall(allow, required).ok) {
        allow.uses += 1;
        return true;
      }
    }
    this.report('OMEGA_E_CAP_MISSING', `agent ${agent.name} does not allow ${action} on ${resource}`, loc, {
      agent: agent.name,
      resource,
      action,
      context,
      allowed: agent.resolvedAllow.map((entry) => `${entry.actions.join(',')} on ${entry.resource}`),
    });
    return false;
  }

  /**
   * Turn a `do`/`untaint` call into a capref. Path namespaces take their scope from a
   * string literal (positional, or named `path`/`scope`), because a scope the compiler
   * cannot see is a scope the kernel cannot check.
   * @returns {{capref: object, args: object[], scopeArgIndex: number}}
   */
  callToCapref(call) {
    const head = call.path.split('.')[0];
    const namespace = BUILTIN_NAMESPACES[head];
    const isPath = namespace !== undefined && namespace.path === true;
    const locator = LOCATOR_ARGUMENTS[head] ?? null;
    const capref = { kind: 'CapRef', path: call.path, loc: call.loc };
    let scopeArgIndex = -1;
    call.args.forEach((arg, index) => {
      if (capref.scope !== undefined) return;
      const value = arg.expr;
      if (value.kind !== 'Literal' || value.type !== 'string') return;
      if (arg.name === null) {
        if (isPath) {
          capref.scope = value.value;
          scopeArgIndex = index;
        }
        return;
      }
      if (arg.name === locator || arg.name === 'path' || arg.name === 'scope') {
        capref.scope = value.value;
        scopeArgIndex = index;
      }
    });
    if (isPath && capref.scope === undefined) {
      throw new OmegaError(
        'OMEGA_E_SCHEMA',
        `${call.path} needs a literal path, e.g. ${call.path}("/src/main.js"): a scope the compiler cannot see cannot be checked`,
        { line: call.loc.line, column: call.loc.column },
      );
    }
    return { capref, scopeArgIndex, isPath };
  }

  analyzeCall(call, { context = 'call' } = {}) {
    let capref = null;
    let scopeArgIndex = -1;
    let isPath = false;
    try {
      ({ capref, scopeArgIndex, isPath } = this.callToCapref(call));
    } catch (cause) {
      const error = cause instanceof OmegaError ? cause : new OmegaError('OMEGA_E_SCHEMA', String(cause));
      this.report(error.code, error.message, call.loc);
      return null;
    }
    const resolved = this.resolveCaprefNode(capref, { pattern: false, where: `call ${call.path}` });
    if (resolved === null) return null;
    const action = resolved.actions[0];
    this.requireCapability(this.agent, resolved.resource, action, call.loc, { context });
    const args = call.args.map((arg, index) => {
      const attrs = this.analyzeExpr(arg.expr);
      const sealed = arg.expr.kind === 'Name' && this.env.get(arg.expr.name)?.sealed === true;
      const effective = sealed ? { ...attrs, secrecy: 'secret' } : attrs;
      if (sealed || isSecret(effective)) {
        if (resolved.accepts_secret !== true) {
          this.report(
            sealed ? SEALED_MISUSE : 'OMEGA_E_SECRET_EGRESS',
            sealed
              ? `sealed value ${arg.expr.name} may only be passed to an instrument that declares \`accepts_secret true\``
              : `a secret value cannot be passed to ${resolved.resource}`,
            arg.loc,
            { resource: resolved.resource, argument: arg.name ?? `arg${index}` },
          );
          return { ...arg, attrs: effective, sealed };
        }
        if (!secretEgressAllows(this.secretRules, resolved.resource) && namespaceOf(resolved.resource) !== 'sanitizer') {
          this.report(
            'OMEGA_E_SECRET_EGRESS',
            `${resolved.resource} accepts secrets but no policy allows it: add \`allow secret -> ${resolved.resource}\``,
            arg.loc,
            { resource: resolved.resource, policy: this.secretRules.map((rule) => `${rule.effect} secret -> ${rule.sink}`) },
          );
        }
        return { ...arg, attrs: effective, sealed };
      }
      const verdict = checkSink('tool_argument', attrs);
      if (!verdict.ok) this.report(verdict.code, verdict.message, arg.loc, { resource: resolved.resource });
      return { ...arg, attrs, sealed };
    });
    return {
      resolved: {
        resource: resolved.resource,
        action,
        trust: resolved.trust,
        accepts_secret: resolved.accepts_secret === true,
        origin: resolved.origin,
      },
      args,
      scopeArgIndex,
      scopeArg: capref.scope ?? null,
      isPath,
    };
  }

  /**
   * Attribute of a call result. A `secrets.load` yields a secret: the type is
   * `SecretString` (opaque in the language, an unread handle at run time), so the value
   * cannot be emitted, remembered, asserted on or passed anywhere except to an
   * instrument that declares `accepts_secret true` — and only when the policy allows it.
   */
  callAttrs(resolved) {
    const secret = namespaceOf(resolved.resource) === 'secrets';
    return { base: secret ? 'string' : 'data', secrecy: secret ? 'secret' : 'public', trust: resolved.trust };
  }

  /** @returns {{base: string, secrecy: string, trust: string}} */
  analyzeExpr(expr) {
    switch (expr.kind) {
      case 'Literal': {
        const attrs = expr.type === 'number'
          ? typeAttrs('Number')
          : expr.type === 'bool' ? typeAttrs('Bool') : typeAttrs('String');
        expr.attrs = attrs;
        return attrs;
      }
      case 'Name': {
        const binding = this.env.get(expr.name);
        if (binding === undefined) {
          this.report('OMEGA_E_UNBOUND', `${expr.name} is not bound at this point`, expr.loc);
          expr.attrs = typeAttrs('UntrustedData');
          return expr.attrs;
        }
        binding.uses += 1;
        expr.attrs = binding.attrs;
        expr.sealed = binding.sealed === true;
        return binding.attrs;
      }
      case 'Call': {
        const analyzed = this.analyzeCall(expr);
        if (analyzed === null) {
          expr.attrs = typeAttrs('UntrustedData');
          return expr.attrs;
        }
        expr.resolved = analyzed.resolved;
        expr.args = analyzed.args;
        expr.scopeArg = analyzed.scopeArg;
        expr.scopeArgIndex = analyzed.scopeArgIndex;
        expr.isPathResource = analyzed.isPath;
        const attrs = this.callAttrs(analyzed.resolved);
        expr.attrs = attrs;
        return attrs;
      }
      case 'Untaint': {
        const binding = this.env.get(expr.name);
        if (binding === undefined) {
          this.report('OMEGA_E_UNBOUND', `untaint ${expr.name}: no such binding`, expr.loc);
          expr.attrs = typeAttrs('UntrustedData');
          return expr.attrs;
        }
        if (!isKnownType(expr.type)) {
          this.report('OMEGA_E_TYPE', `unknown type ${JSON.stringify(expr.type)}`, expr.loc);
          expr.attrs = typeAttrs('UntrustedData');
          return expr.attrs;
        }
        const analyzed = this.analyzeCall(expr.call, { context: 'declassification' });
        if (analyzed === null) {
          expr.attrs = typeAttrs('UntrustedData');
          return expr.attrs;
        }
        if (analyzed.resolved.trust !== 'verified') {
          this.report(
            'OMEGA_E_SANITIZER_UNTRUSTED',
            `${analyzed.resolved.resource} is declared trust ${analyzed.resolved.trust}; declassification requires \`trust verified\``,
            expr.loc,
            { resource: analyzed.resolved.resource, trust: analyzed.resolved.trust },
          );
        }
        expr.resolved = analyzed.resolved;
        expr.args = analyzed.args;
        expr.scopeArg = analyzed.scopeArg;
        expr.from = describeAttrs(binding.attrs);
        const target = typeAttrs(expr.type);
        expr.attrs = target;
        return target;
      }
      case 'Not': {
        const inner = this.analyzeExpr(expr.expr);
        if (inner.base !== 'bool') this.report('OMEGA_E_TYPE', `\`not\` needs a Bool, found ${describeAttrs(inner)}`, expr.loc);
        const attrs = { ...inner, base: 'bool' };
        expr.attrs = attrs;
        return attrs;
      }
      case 'Binary': {
        const left = this.analyzeExpr(expr.left);
        const right = this.analyzeExpr(expr.right);
        const joined = joinAttrs(left, right);
        if (expr.op === 'and' || expr.op === 'or') {
          if (left.base !== 'bool' || right.base !== 'bool') {
            this.report('OMEGA_E_TYPE', `\`${expr.op}\` needs Bool operands, found ${describeAttrs(left)} and ${describeAttrs(right)}`, expr.loc);
          }
          expr.attrs = { ...joined, base: 'bool' };
          return expr.attrs;
        }
        if (expr.op === '+' || expr.op === '-') {
          if (left.base !== 'number' || right.base !== 'number') {
            this.report('OMEGA_E_TYPE', `\`${expr.op}\` needs Number operands, found ${describeAttrs(left)} and ${describeAttrs(right)}`, expr.loc);
          }
          expr.attrs = { ...joined, base: 'number' };
          return expr.attrs;
        }
        expr.attrs = { ...joined, base: 'bool' };
        return expr.attrs;
      }
      default:
        this.report('OMEGA_E_SCHEMA', `unknown expression ${String(expr.kind)}`, expr.loc);
        expr.attrs = typeAttrs('UntrustedData');
        return expr.attrs;
    }
  }

  /** @param {string} name @param {object} binding */
  bind(name, binding) {
    if (this.env.has(name)) {
      this.report('OMEGA_E_DUPLICATE', `${name} is already bound in this mission`, binding.loc);
      return;
    }
    this.env.set(name, binding);
  }

  analyzeMission(mission) {
    const agent = this.agents.get(mission.agent);
    if (agent === undefined) {
      this.report('OMEGA_E_SCHEMA', `mission ${mission.name} names agent ${mission.agent}, which is not declared`, mission.loc, {
        agents: [...this.agents.keys()].sort(),
      });
      return null;
    }
    this.agent = agent;
    this.env = new Map();
    this.emitCount = 0;
    this.claims = new Set();
    agent.usedByMission = true;

    const preconditions = [];
    for (const requirement of mission.requirements) {
      if (requirement.kind !== 'capability') continue;
      const resolved = this.resolveCaprefNode(requirement.capref, { pattern: true, where: `require capability in ${mission.name}` });
      if (resolved === null) continue;
      this.requireCapability(agent, resolved.resource, resolved.actions[0], requirement.loc, { context: 'precondition' });
      preconditions.push({ resource: resolved.resource, action: resolved.actions[0] });
    }

    const statements = [];
    for (const statement of mission.statements) {
      const analyzed = this.analyzeStatement(statement);
      if (analyzed !== null) statements.push(analyzed);
    }

    const contracts = [];
    for (const requirement of mission.requirements) {
      if (requirement.kind !== 'evidence') continue;
      contracts.push({ claim: requirement.claim, loc: requirement.loc });
      if (!this.claims.has(requirement.claim)) {
        this.report(
          'OMEGA_E_CONTRACT_UNMET',
          `mission ${mission.name} requires evidence "${requirement.claim}" but no statement produces that claim`,
          requirement.loc,
        );
      }
    }

    if (mission.plan.length === 0) {
      this.report('OMEGA_W_NO_PLAN', `mission ${mission.name} declares no plan`, mission.loc);
    }
    if (!statements.some((statement) => statement.kind === 'Observe')) {
      this.report('OMEGA_W_NO_OBSERVE', `mission ${mission.name} never observes the world`, mission.loc);
    }
    if (this.emitCount === 0) {
      this.report('OMEGA_W_UNUSED_CAPABILITY', `mission ${mission.name} never emits a result`, mission.loc);
    }

    const requirementNames = new Set(contracts.map((contract) => contract.claim));
    const emitted = statements.find((statement) => statement.kind === 'Emit') ?? null;
    return {
      name: mission.name,
      agent: mission.agent,
      goal: mission.goal,
      plan: [...mission.plan],
      requirements: mission.requirements.map((requirement) => (
        requirement.kind === 'capability'
          ? { kind: 'capability', resource: requirement.capref.path, loc: requirement.loc }
          : { kind: 'evidence', claim: requirement.claim, loc: requirement.loc }
      )),
      contracts,
      contractClaims: [...requirementNames].sort(),
      preconditions,
      statements,
      emit: emitted,
      loc: mission.loc,
    };
  }

  analyzeStatement(statement) {
    switch (statement.kind) {
      case 'Let': {
        const attrs = this.analyzeExpr(statement.expr);
        let declared = null;
        if (statement.type !== null) {
          if (!isKnownType(statement.type)) {
            this.report('OMEGA_E_TYPE', `unknown type ${JSON.stringify(statement.type)}`, statement.loc, {
              known: Object.keys(TYPE_TABLE).sort(),
            });
          } else {
            declared = typeAttrs(statement.type);
            const verdict = assignable(attrs, declared);
            if (!verdict.ok) {
              this.report(
                verdict.axis === 'secrecy' ? 'OMEGA_E_SECRET_EGRESS' : 'OMEGA_E_TYPE',
                `cannot bind ${describeAttrs(attrs)} as ${statement.type}: ${verdict.reason}`,
                statement.loc,
                { from: describeAttrs(attrs), to: statement.type },
              );
            }
          }
        }
        // A secret that is written into the source is not a secret: it is a credential in
        // a file. `vault://` handles exist so that this cannot happen, so a string literal
        // bound to a secret-typed name is refused outright.
        if (declared !== null && declared.secrecy === 'secret' && statement.expr.kind === 'Literal' && statement.expr.type === 'string') {
          this.report(
            'OMEGA_E_SECRET_LITERAL',
            `a ${statement.type} cannot be built from a literal: bind a handle instead, e.g. let ${statement.name}: SecretString = secrets.load(name: "provider")`,
            statement.loc,
          );
        }
        const bindingAttrs = declared ?? attrs;
        const declassified = statement.expr.kind === 'Untaint';
        this.bind(statement.name, {
          kind: declassified ? 'untaint' : 'let',
          attrs: bindingAttrs,
          ...(declassified ? { declassifiedFrom: statement.expr.from } : {}),
          declaredType: statement.type,
          sealed: false,
          immutable: declassified,
          loc: statement.loc,
          uses: 0,
        });
        return {
          ...statement,
          attrs: bindingAttrs,
          typeName: describeAttrs(bindingAttrs),
          sealed: false,
          ...(declassified ? { declassified: true, from: statement.expr.from } : {}),
        };
      }
      case 'Set': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) {
          this.report('OMEGA_E_UNBOUND', `set ${statement.name}: no such binding`, statement.loc);
          return null;
        }
        if (binding.immutable === true) {
          this.report('OMEGA_E_IMMUTABLE', `${statement.name} is ${binding.sealed ? 'sealed' : 'the result of a declassification'} and cannot be reassigned`, statement.loc);
          return null;
        }
        const attrs = this.analyzeExpr(statement.expr);
        const verdict = assignable(attrs, binding.attrs);
        if (!verdict.ok) {
          this.report(
            verdict.axis === 'secrecy' ? 'OMEGA_E_SECRET_EGRESS' : 'OMEGA_E_TYPE',
            `set ${statement.name}: ${verdict.reason}`,
            statement.loc,
            { from: describeAttrs(attrs), to: binding.declaredType ?? describeAttrs(binding.attrs) },
          );
        }
        return { ...statement, attrs: binding.attrs };
      }
      case 'Do': {
        const analyzed = this.analyzeCall(statement.call);
        if (analyzed === null) return null;
        const attrs = this.callAttrs(analyzed.resolved);
        if (statement.as !== null) {
          this.bind(statement.as, {
            kind: 'let',
            attrs,
            declaredType: describeAttrs(attrs),
            sealed: false,
            immutable: false,
            loc: statement.loc,
            uses: 0,
          });
        }
        return {
          ...statement,
          resolved: analyzed.resolved,
          args: analyzed.args,
          attrs,
          typeName: describeAttrs(attrs),
          isPathResource: analyzed.isPath,
        };
      }
      case 'Seal': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) {
          this.report('OMEGA_E_UNBOUND', `seal ${statement.name}: no such binding`, statement.loc);
          return null;
        }
        if (!isSecret(binding.attrs)) {
          this.report(
            'OMEGA_E_TYPE',
            `seal ${statement.name}: only a secret (SecretString, SecretNumber, Capability …) can be sealed; this binding is ${describeAttrs(binding.attrs)}`,
            statement.loc,
          );
          return null;
        }
        binding.sealed = true;
        binding.immutable = true;
        return { ...statement, attrs: binding.attrs, typeName: describeAttrs(binding.attrs) };
      }
      case 'Observe': {
        this.requireCapability(this.agent, `world:${statement.key}`, 'read', statement.loc, { context: 'observation' });
        return { ...statement, resolved: { resource: `world:${statement.key}`, action: 'read' } };
      }
      case 'Remember': {
        if (!MEMORY_TIERS.includes(statement.tier)) {
          this.report('OMEGA_E_SCHEMA', `unknown memory tier ${statement.tier}`, statement.loc);
          return null;
        }
        const binding = this.env.get(statement.name);
        if (binding === undefined) {
          this.report('OMEGA_E_UNBOUND', `remember ${statement.name}: no such binding`, statement.loc);
          return null;
        }
        const verdict = checkSink('remember', binding.attrs);
        if (!verdict.ok) this.report(verdict.code, verdict.message, statement.loc, { tier: statement.tier });
        this.requireCapability(this.agent, `memory:${statement.tier}`, 'store', statement.loc, { context: 'memory write' });
        return { ...statement, attrs: binding.attrs, typeName: describeAttrs(binding.attrs), resolved: { resource: `memory:${statement.tier}`, action: 'store' } };
      }
      case 'Recall': {
        this.requireCapability(this.agent, `memory:${statement.tier}`, 'read', statement.loc, { context: 'memory read' });
        const attrs = typeAttrs('MemoryRef');
        this.bind(statement.name, { kind: 'recall', attrs, declaredType: 'MemoryRef', sealed: false, immutable: false, loc: statement.loc, uses: 0 });
        return { ...statement, attrs, typeName: 'MemoryRef', resolved: { resource: `memory:${statement.tier}`, action: 'read' } };
      }
      case 'Assert': {
        const left = this.analyzeExpr(statement.left);
        const right = this.analyzeExpr(statement.right);
        const joined = joinAttrs(left, right);
        const verdict = checkSink('assertion', joined);
        if (!verdict.ok) this.report(verdict.code, verdict.message, statement.loc);
        return { ...statement, attrs: joined };
      }
      case 'AssertType': {
        const binding = this.env.get(statement.name);
        if (binding === undefined) {
          this.report('OMEGA_E_UNBOUND', `assert ${statement.name}: no such binding`, statement.loc);
          return null;
        }
        if (!isKnownType(statement.type)) {
          this.report('OMEGA_E_TYPE', `unknown type ${JSON.stringify(statement.type)}`, statement.loc);
          return null;
        }
        const target = typeAttrs(statement.type);
        if (!assignable(binding.attrs, target).ok && describeAttrs(binding.attrs) !== statement.type) {
          this.report(
            'OMEGA_E_TYPE',
            `assert ${statement.name} is ${statement.type} can never hold: ${statement.name} is ${describeAttrs(binding.attrs)}`,
            statement.loc,
          );
          return null;
        }
        if (binding.declaredType === statement.type) {
          this.report('OMEGA_W_ALWAYS_TRUE', `assert ${statement.name} is ${statement.type} is provable at compile time`, statement.loc);
        }
        return { ...statement, attrs: binding.attrs };
      }
      case 'Evidence': {
        const attrs = statement.from === null ? typeAttrs('String') : this.analyzeExpr({ kind: 'Name', name: statement.from, loc: statement.loc });
        if (statement.from === null) {
          this.report('OMEGA_E_EVIDENCE_UNTRUSTED', 'evidence must cite a verified binding: `evidence claim "…" from x`', statement.loc);
          return null;
        }
        const verdict = checkSink('evidence', attrs);
        if (!verdict.ok) {
          this.report(verdict.code, verdict.message, statement.loc, { claim: statement.claim, from: statement.from, trust: attrs.trust });
          return null;
        }
        this.claims.add(statement.claim);
        return { ...statement, attrs, typeName: describeAttrs(attrs) };
      }
      case 'Emit': {
        const attrs = this.analyzeExpr(statement.expr);
        this.emitCount += 1;
        if (this.emitCount > 1) {
          this.report('OMEGA_E_MULTIPLE_EMIT', 'a mission emits exactly one result', statement.loc);
          return null;
        }
        if (statement.expr.kind === 'Name' && this.env.get(statement.expr.name)?.sealed === true) {
          this.report(SEALED_MISUSE, `emit ${statement.expr.name}: a sealed value never leaves the program`, statement.loc);
          return null;
        }
        const verdict = checkSink('emit', attrs);
        if (!verdict.ok) this.report(verdict.code, verdict.message, statement.loc);
        return { ...statement, attrs, typeName: describeAttrs(attrs) };
      }
      case 'If': {
        const cond = this.analyzeExpr(statement.cond);
        if (cond.base !== 'bool') {
          this.report('OMEGA_E_TYPE', `if needs a Bool condition, found ${describeAttrs(cond)}`, statement.loc);
        }
        const outer = this.env;
        this.env = new Map(outer);
        const then = statement.then.map((item) => this.analyzeStatement(item)).filter((item) => item !== null);
        this.env = new Map(outer);
        const otherwise = statement.else.map((item) => this.analyzeStatement(item)).filter((item) => item !== null);
        this.env = outer;
        if (then.some((item) => item.kind === 'Emit') || otherwise.some((item) => item.kind === 'Emit')) {
          this.report('OMEGA_E_MULTIPLE_EMIT', 'a mission emits exactly one result, and not from inside a branch', statement.loc);
        }
        // `cond` stays the *expression*; `attrs` is what the type system concluded about
        // it. Overwriting the expression here was a real bug: every `if` lowered to a node
        // the IR could not describe, so a conditional module compiled and then failed at
        // run time with `OMEGA_E_SCHEMA: unknown expression kind`.
        return { ...statement, cond: statement.cond, attrs: cond, then, else: otherwise };
      }
      case 'Fail':
        return { ...statement };
      default:
        this.report('OMEGA_E_SCHEMA', `unknown statement ${String(statement.kind)}`, statement.loc);
        return null;
    }
  }

  analyzeProposals() {
    for (const declaration of this.program.declarations) {
      if (declaration.kind !== 'Evolve') continue;
      this.proposals.push({
        module: declaration.module,
        from: declaration.from,
        to: declaration.to,
        hypothesis: declaration.hypothesis,
        expects: declaration.expects.map((expectation) => ({ ...expectation })),
        loc: declaration.loc,
      });
    }
  }

  analyze() {
    this.collect();
    for (const instrument of [...this.instruments.values()]) {
      this.instruments.set(instrument.name, this.resolveInstrument(instrument));
    }
    this.resolveProviders();
    this.resolveAgents();
    this.resolveGrants();
    this.resolvePolicies();
    const missions = [];
    for (const mission of this.missions.values()) {
      const analyzed = this.analyzeMission(mission);
      if (analyzed !== null) missions.push(analyzed);
    }
    this.analyzeProposals();

    for (const agent of this.agents.values()) {
      if (agent.usedByMission !== true) continue;
      for (const entry of agent.resolvedAllow ?? []) {
        if (entry.uses === 0) {
          this.report(
            'OMEGA_W_UNUSED_CAPABILITY',
            `agent ${agent.name} allows ${entry.actions.join(',')} on ${entry.resource} but no call site uses it`,
            entry.capref.loc,
          );
        }
      }
    }

    if (this.program.declarations.length === 0) {
      this.report('OMEGA_E_SCHEMA', 'a module declares something: a mission, an agent, a policy, an instrument or a grant', null);
    }

    const module = {
      omega: 1,
      path: this.path,
      agents: [...this.agents.values()].map((agent) => ({
        name: agent.name,
        role: agent.role,
        model: agent.model,
        allow: (agent.resolvedAllow ?? []).map((entry) => ({ resource: entry.resource, actions: entry.actions, origin: entry.origin })),
        deny: (agent.resolvedDeny ?? []).map((entry) => ({ resource: entry.resource, actions: entry.actions, origin: entry.origin })),
        loc: agent.loc,
      })),
      servers: [...this.servers.values()].map((server) => ({ name: server.name, tools: [...server.tools] })),
      instruments: [...this.instruments.values()].map((instrument) => ({
        name: instrument.name,
        resource: instrument.resource,
        actions: instrument.actions,
        trust: instrument.trust,
        accepts_secret: instrument.accepts_secret === true,
        provider: instrument.provider,
      })),
      grants: this.grants,
      providers: [...this.providers.values()].map((provider) => ({
        name: provider.name,
        secret: provider.secret,
        strategy: provider.strategy,
        fallback: [...provider.fallback],
        max_cost: provider.maxCost,
      })),
      policies: this.policies,
      secret_rules: this.secretRules,
      limits: this.limits,
      missions,
      proposals: this.proposals,
    };
    this.module = module;
    return { diagnostics: this.diagnostics, module, ok: !hasErrors(this.diagnostics) };
  }
}

/**
 * @param {object} program
 * @param {{path?: string}} [options]
 * @returns {{ok: boolean, diagnostics: Diagnostic[], module: object|null}}
 */
export function analyze(program, { path = '<source>' } = {}) {
  const analyzer = new Analyzer(program, { path });
  const result = analyzer.analyze();
  return { ok: result.ok, diagnostics: result.diagnostics, module: result.module };
}
