/**
 * Recursive-descent parser for `.nexa` modules.
 *
 * Node shapes (the analyser, the IR and the runtime all read these):
 *
 *   Program   { kind:'Program', omega:1, path, declarations:[…] }
 *   Policy    { name, rules:[{effect:'ALLOW'|'DENY', capref}], limits:{maxRuntimeMs?,maxSteps?},
 *               secretRules:[{effect, sink}] }
 *   Agent     { name, role, model, allow:[CapRef], deny:[CapRef] }
 *   Mcp       { name, tools:[string] }
 *   Instrument{ name, resource, actions:[string], trust, acceptsSecret, provider }
 *   Grant     { name, scope, subject, ttlMs, maxCalls, approval }
 *   Provider  { name, secret, strategy, fallback:[string], maxCost }
 *   Mission   { name, agent, goal, plan:[string], requirements:[…], statements:[…], emit }
 *   Evolve    { module, from, to, hypothesis, expects:[{metric, op, value}] }
 *   CapRef    { kind:'CapRef', path?, resource?, scope?, actions?, loc }
 *   Stmt      { kind: 'Let'|'Set'|'Do'|Require|Observe|Remember|Recall|Untaint|Seal|Assert|Evidence|Emit|If|Fail, … }
 *   Expr      { kind: 'Literal'|'Name'|'Call'|'Binary'|'Not', … }
 *
 * Syntax errors throw an OmegaError carrying `line`/`column`; a module either parses
 * completely or not at all, so nothing downstream ever sees a half-built program.
 */
import { OmegaError } from './errors.js';
import { TOKEN, tokenize, durationToMs } from './lexer.js';

/** Words that may not be used as a declaration name, and that end a list. */
export const RESERVED_WORDS = Object.freeze(new Set([
  'nexa', 'omega', 'policy', 'agent', 'mcp', 'instrument', 'grant', 'provider', 'mission', 'evolve',
  'role', 'model', 'allow', 'deny', 'resource', 'actions', 'trust', 'accepts_secret', 'provider_id',
  'tools', 'subject', 'scope', 'ttl', 'max_calls', 'max_cost', 'max_runtime', 'max_steps', 'require',
  'approval', 'secret', 'strategy', 'fallback', 'goal', 'plan', 'let', 'set', 'do', 'as', 'observe',
  'remember', 'recall', 'untaint', 'via', 'seal', 'assert', 'is', 'evidence', 'claim', 'from', 'emit',
  'if', 'else', 'fail', 'true', 'false', 'not', 'and', 'or',
]));

export const MEMORY_TIERS = Object.freeze(['working', 'episodic', 'semantic', 'procedural', 'meta', 'evolution']);
const COMPARISON_OPS = Object.freeze(['==', '!=', '<', '<=', '>', '>=']);
const TOKEN_FOR_OP = Object.freeze({
  '==': TOKEN.EQEQ, '!=': TOKEN.NEQ, '<': TOKEN.LT, '<=': TOKEN.LE, '>': TOKEN.GT, '>=': TOKEN.GE,
});

class Cursor {
  constructor(source) {
    this.tokens = tokenize(source);
    this.index = 0;
    this.last = null;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.tokens[this.index];
    if (token.type !== TOKEN.EOF) this.index += 1;
    this.last = token;
    return token;
  }

  check(type, value = undefined) {
    const token = this.peek();
    if (token.type !== type) return false;
    return value === undefined || token.value === value;
  }

  checkIdent(value) {
    return this.check(TOKEN.IDENT, value);
  }

  match(type) {
    if (!this.check(type)) return null;
    return this.next();
  }

  expect(type, what) {
    const token = this.peek();
    if (token.type !== type) {
      throw this.error('OMEGA_E_PARSE', `expected ${what ?? type}, found ${describeToken(token)}`, token);
    }
    return this.next();
  }

  error(code, message, token = this.peek()) {
    return new OmegaError(code, message, { line: token.line, column: token.column });
  }

  loc(token = this.peek()) {
    return { line: token.line, column: token.column };
  }

  /** Consume any run of newlines and commas (they separate list items). */
  skipSeparators() {
    while (this.check(TOKEN.NEWLINE) || this.check(TOKEN.COMMA)) this.next();
  }
}

function describeToken(token) {
  if (token.type === TOKEN.EOF) return 'end of input';
  if (token.type === TOKEN.NEWLINE) return 'end of line';
  if (token.type === TOKEN.STRING) return `string ${JSON.stringify(token.value)}`;
  return `${token.type} ${JSON.stringify(token.value)}`;
}

class Parser {
  constructor(source, { path = '<source>' } = {}) {
    this.cursor = new Cursor(source);
    this.path = path;
  }

  parse() {
    const cursor = this.cursor;
    cursor.skipSeparators();
    const header = cursor.expect(TOKEN.IDENT, '`nexa omega <version>`');
    if (header.value !== 'nexa') {
      throw cursor.error('OMEGA_E_PARSE', `a module starts with \`nexa omega 1\`, found ${JSON.stringify(header.value)}`, header);
    }
    const product = cursor.expect(TOKEN.IDENT, '`omega`');
    if (product.value !== 'omega') {
      throw cursor.error('OMEGA_E_PARSE', `expected the Ω product name \`omega\`, found ${JSON.stringify(product.value)}`, product);
    }
    const version = cursor.expect(TOKEN.INT, 'the language version `1`');
    if (version.value !== '1') {
      throw cursor.error('OMEGA_E_SCHEMA', `unsupported Ω language version ${version.value}; this compiler implements version 1`, version);
    }
    const declarations = [];
    for (;;) {
      cursor.skipSeparators();
      if (cursor.check(TOKEN.EOF)) break;
      declarations.push(this.parseDeclaration());
    }
    return { kind: 'Program', omega: 1, path: this.path, declarations };
  }

  parseDeclaration() {
    const cursor = this.cursor;
    const token = cursor.expect(TOKEN.IDENT, 'a declaration keyword');
    switch (token.value) {
      case 'policy': return this.parsePolicy(token);
      case 'agent': return this.parseAgent(token);
      case 'mcp': return this.parseMcp(token);
      case 'instrument': return this.parseInstrument(token);
      case 'grant': return this.parseGrant(token);
      case 'provider': return this.parseProvider(token);
      case 'mission': return this.parseMission(token);
      case 'evolve': return this.parseEvolve(token);
      default:
        throw cursor.error(
          'OMEGA_E_SCHEMA',
          `unknown declaration \`${token.value}\`; expected policy, agent, mcp, instrument, grant, provider, mission or evolve`,
          token,
        );
    }
  }

  /** A declaration name: a plain identifier that is not a keyword. */
  parseName(what) {
    const cursor = this.cursor;
    const token = cursor.expect(TOKEN.IDENT, `${what} name`);
    if (token.value.includes('.')) {
      throw cursor.error('OMEGA_E_SCHEMA', `a ${what} name cannot contain a dot: ${token.value}`, token);
    }
    if (RESERVED_WORDS.has(token.value)) {
      throw cursor.error('OMEGA_E_SCHEMA', `\`${token.value}\` is a reserved word and cannot name a ${what}`, token);
    }
    return { name: token.value, loc: cursor.loc(token) };
  }

  /** `{ newline item* }` with one statement per line (commas also separate). */
  parseBlock(what, parseItem) {
    const cursor = this.cursor;
    cursor.expect(TOKEN.LBRACE, `\`{\` to open ${what}`);
    const items = [];
    for (;;) {
      cursor.skipSeparators();
      if (cursor.check(TOKEN.RBRACE)) break;
      if (cursor.check(TOKEN.EOF)) throw cursor.error('OMEGA_E_PARSE', `unterminated ${what}: missing \`}\``);
      items.push(parseItem.call(this));
      this.endOfStatement(`after an item in ${what}`);
    }
    cursor.expect(TOKEN.RBRACE, `\`}\` to close ${what}`);
    return items;
  }

  /** Statements end at a newline or a comma; a `}` also ends the last one. */
  endOfStatement(where) {
    const cursor = this.cursor;
    if (cursor.check(TOKEN.RBRACE) || cursor.check(TOKEN.EOF)) return;
    if (cursor.check(TOKEN.NEWLINE) || cursor.check(TOKEN.COMMA)) {
      cursor.skipSeparators();
      return;
    }
    // A list parser (`allow a, b` / `tools x, y`) consumes its own separators, so the
    // statement is already terminated even though the cursor sits on the next word.
    if (cursor.last !== null && (cursor.last.type === TOKEN.NEWLINE || cursor.last.type === TOKEN.COMMA)) return;
    throw cursor.error('OMEGA_E_PARSE', `expected end of statement ${where}, found ${describeToken(cursor.peek())}`);
  }

  /** @returns {object} a CapRef node */
  parseCapref() {
    const cursor = this.cursor;
    const token = cursor.expect(TOKEN.IDENT, 'a capability reference');
    const capref = { kind: 'CapRef', path: token.value, loc: cursor.loc(token) };
    if (token.value === 'resource') {
      const resource = cursor.expect(TOKEN.STRING, 'a quoted resource id after `resource`');
      capref.resource = resource.value;
      delete capref.path;
      const actions = [];
      while (cursor.check(TOKEN.IDENT) && !RESERVED_WORDS.has(cursor.peek().value)) {
        actions.push(cursor.next().value);
      }
      if (actions.length === 0) {
        throw cursor.error('OMEGA_E_SCHEMA', 'the `resource "…"` form needs at least one action');
      }
      capref.actions = actions;
      return capref;
    }
    if (cursor.check(TOKEN.LPAREN)) {
      cursor.next();
      const scope = cursor.expect(TOKEN.STRING, 'a quoted scope');
      cursor.expect(TOKEN.RPAREN, '`)` to close the scope');
      capref.scope = scope.value;
    }
    return capref;
  }

  parseCaprefList() {
    const cursor = this.cursor;
    const items = [this.parseCapref()];
    for (;;) {
      if (cursor.check(TOKEN.RBRACE) || cursor.check(TOKEN.EOF)) break;
      if (cursor.check(TOKEN.NEWLINE) || cursor.check(TOKEN.COMMA)) {
        cursor.skipSeparators();
        if (cursor.check(TOKEN.RBRACE) || cursor.check(TOKEN.EOF)) break;
        if (cursor.check(TOKEN.IDENT) && RESERVED_WORDS.has(cursor.peek().value)) break;
        items.push(this.parseCapref());
        continue;
      }
      throw cursor.error('OMEGA_E_PARSE', `expected a separator between capability references, found ${describeToken(cursor.peek())}`);
    }
    return items;
  }

  parseStringList() {
    const cursor = this.cursor;
    const items = [cursor.expect(TOKEN.IDENT, 'a name').value];
    for (;;) {
      if (cursor.check(TOKEN.RBRACE) || cursor.check(TOKEN.EOF)) break;
      if (cursor.check(TOKEN.NEWLINE) || cursor.check(TOKEN.COMMA)) {
        cursor.skipSeparators();
        if (cursor.check(TOKEN.RBRACE) || cursor.check(TOKEN.EOF)) break;
        if (cursor.check(TOKEN.IDENT) && RESERVED_WORDS.has(cursor.peek().value)) break;
        items.push(cursor.expect(TOKEN.IDENT, 'a name').value);
        continue;
      }
      throw cursor.error('OMEGA_E_PARSE', `expected a separator between names, found ${describeToken(cursor.peek())}`);
    }
    return items;
  }

  parsePolicy(keyword) {
    const cursor = this.cursor;
    const { name, loc } = this.parseName('policy');
    const rules = [];
    const secretRules = [];
    const limits = {};
    this.parseBlock(`policy ${name}`, function parsePolicyField() {
      const field = cursor.expect(TOKEN.IDENT, 'a policy statement');
      if (field.value === 'allow' || field.value === 'deny') {
        if (cursor.checkIdent('secret')) {
          cursor.next();
          cursor.expect(TOKEN.ARROW, '`->` in a secret egress rule');
          const sink = cursor.expect(TOKEN.IDENT, 'a sink name');
          secretRules.push({ effect: field.value === 'allow' ? 'ALLOW' : 'DENY', sink: sink.value, loc: cursor.loc(field) });
          return;
        }
        for (const capref of this.parseCaprefList()) {
          rules.push({ effect: field.value === 'allow' ? 'ALLOW' : 'DENY', capref, loc: cursor.loc(field) });
        }
        return;
      }
      if (field.value === 'max_runtime') {
        const duration = cursor.expect(TOKEN.DURATION, 'a duration like `30s`');
        limits.maxRuntimeMs = durationToMs(duration.value);
        return;
      }
      if (field.value === 'max_steps') {
        const steps = cursor.expect(TOKEN.INT, 'an integer step budget');
        limits.maxSteps = Number.parseInt(steps.value, 10);
        if (limits.maxSteps <= 0) throw cursor.error('OMEGA_E_SCHEMA', 'max_steps must be positive', steps);
        return;
      }
      throw cursor.error('OMEGA_E_SCHEMA', `unknown policy statement \`${field.value}\``, field);
    });
    return { kind: 'Policy', name, rules, secretRules, limits, loc };
  }

  parseAgent(keyword) {
    const cursor = this.cursor;
    const { name, loc } = this.parseName('agent');
    const agent = { kind: 'Agent', name, role: 'generalist', model: null, allow: [], deny: [], loc };
    this.parseBlock(`agent ${name}`, function parseAgentField() {
      const field = cursor.expect(TOKEN.IDENT, 'an agent field');
      switch (field.value) {
        case 'role': {
          const role = cursor.expect(TOKEN.IDENT, 'a role name');
          agent.role = role.value;
          return;
        }
        case 'model': {
          const model = cursor.expect(TOKEN.IDENT, 'a provider reference like `provider.auto`');
          if (!model.value.startsWith('provider.')) {
            throw cursor.error('OMEGA_E_SCHEMA', `a model reference looks like \`provider.<name>\`, found ${JSON.stringify(model.value)}`, model);
          }
          agent.model = model.value.slice('provider.'.length);
          agent.modelLoc = cursor.loc(model);
          return;
        }
        case 'allow':
          agent.allow.push(...this.parseCaprefList());
          return;
        case 'deny':
          agent.deny.push(...this.parseCaprefList());
          return;
        default:
          throw cursor.error('OMEGA_E_SCHEMA', `unknown agent field \`${field.value}\``, field);
      }
    });
    return agent;
  }

  parseMcp(keyword) {
    const cursor = this.cursor;
    const { name, loc } = this.parseName('mcp server');
    const server = { kind: 'Mcp', name, tools: [], loc };
    this.parseBlock(`mcp ${name}`, function parseMcpField() {
      const field = cursor.expect(TOKEN.IDENT, 'an mcp field');
      if (field.value !== 'tools') throw cursor.error('OMEGA_E_SCHEMA', `unknown mcp field \`${field.value}\``, field);
      server.tools.push(...this.parseStringList());
    });
    if (server.tools.length === 0) {
      throw cursor.error('OMEGA_E_SCHEMA', `mcp server ${name} declares no tools`, keyword);
    }
    server.tools = [...new Set(server.tools)].sort();
    return server;
  }

  parseInstrument(keyword) {
    const cursor = this.cursor;
    const token = cursor.expect(TOKEN.IDENT, 'an instrument name');
    if (RESERVED_WORDS.has(token.value)) {
      throw cursor.error('OMEGA_E_SCHEMA', `\`${token.value}\` is a reserved word and cannot name an instrument`, token);
    }
    const name = token.value;
    const instrument = {
      kind: 'Instrument',
      name,
      resource: null,
      actions: ['call'],
      trust: 'untrusted',
      acceptsSecret: false,
      provider: 'kernel',
      loc: cursor.loc(token),
    };
    this.parseBlock(`instrument ${name}`, function parseInstrumentField() {
      const field = cursor.expect(TOKEN.IDENT, 'an instrument field');
      switch (field.value) {
        case 'resource': {
          const resource = cursor.expect(TOKEN.STRING, 'a quoted resource id');
          instrument.resource = resource.value;
          return;
        }
        case 'actions': {
          const actions = [cursor.expect(TOKEN.IDENT, 'an action name').value];
          while (cursor.check(TOKEN.COMMA)) {
            cursor.next();
            actions.push(cursor.expect(TOKEN.IDENT, 'an action name').value);
          }
          instrument.actions = [...new Set(actions)].sort();
          return;
        }
        case 'trust': {
          const trust = cursor.expect(TOKEN.IDENT, '`verified`, `untrusted` or `internal`');
          if (!['verified', 'untrusted', 'internal'].includes(trust.value)) {
            throw cursor.error('OMEGA_E_SCHEMA', `trust must be verified, untrusted or internal; found ${trust.value}`, trust);
          }
          instrument.trust = trust.value;
          return;
        }
        case 'accepts_secret': {
          const value = cursor.expect(TOKEN.IDENT, '`true` or `false`');
          if (!['true', 'false'].includes(value.value)) {
            throw cursor.error('OMEGA_E_SCHEMA', 'accepts_secret is `true` or `false`', value);
          }
          instrument.acceptsSecret = value.value === 'true';
          return;
        }
        case 'provider': {
          const provider = cursor.expect(TOKEN.IDENT, 'a provider name');
          instrument.provider = provider.value;
          return;
        }
        default:
          throw cursor.error('OMEGA_E_SCHEMA', `unknown instrument field \`${field.value}\``, field);
      }
    });
    if (instrument.resource === null) {
      throw cursor.error('OMEGA_E_SCHEMA', `instrument ${name} needs a \`resource "…"\` binding`, keyword);
    }
    return instrument;
  }

  parseGrant(keyword) {
    const cursor = this.cursor;
    const capref = this.parseCapref();
    const grant = {
      kind: 'Grant',
      capref,
      name: capref.path ?? capref.resource,
      subject: 'any',
      scope: null,
      ttlMs: 300_000,
      maxCalls: 1,
      approval: null,
      loc: capref.loc,
    };
    if (capref.path === undefined) {
      throw cursor.error('OMEGA_E_SCHEMA', 'a grant names a capability reference, not `resource "…"`', keyword);
    }
    this.parseBlock(`grant ${grant.name}`, function parseGrantField() {
      const field = cursor.expect(TOKEN.IDENT, 'a grant field');
      switch (field.value) {
        case 'subject': {
          const subject = cursor.expect(TOKEN.IDENT, 'an agent name or `any`');
          grant.subject = subject.value;
          return;
        }
        case 'scope': {
          const scope = cursor.expect(TOKEN.STRING, 'a quoted scope');
          grant.scope = scope.value;
          return;
        }
        case 'ttl': {
          const ttl = cursor.expect(TOKEN.DURATION, 'a duration like `10m`');
          grant.ttlMs = durationToMs(ttl.value);
          return;
        }
        case 'max_calls': {
          const calls = cursor.expect(TOKEN.INT, 'an integer call budget');
          grant.maxCalls = Number.parseInt(calls.value, 10);
          if (grant.maxCalls <= 0) throw cursor.error('OMEGA_E_SCHEMA', 'max_calls must be positive', calls);
          return;
        }
        case 'require': {
          const keywordToken = cursor.expect(TOKEN.IDENT, '`approval`');
          if (keywordToken.value !== 'approval') {
            throw cursor.error('OMEGA_E_SCHEMA', 'the only grant requirement in v1 is `require approval(<who>)`', keywordToken);
          }
          cursor.expect(TOKEN.LPAREN, '`(` after approval');
          const who = cursor.expect(TOKEN.IDENT, 'the approver');
          cursor.expect(TOKEN.RPAREN, '`)` after the approver');
          grant.approval = who.value;
          return;
        }
        default:
          throw cursor.error('OMEGA_E_SCHEMA', `unknown grant field \`${field.value}\``, field);
      }
    });
    return grant;
  }

  parseProvider(keyword) {
    const cursor = this.cursor;
    const { name, loc } = this.parseName('provider');
    const provider = {
      kind: 'Provider',
      name,
      secret: null,
      strategy: 'declared',
      fallback: [],
      maxCost: null,
      loc,
    };
    this.parseBlock(`provider ${name}`, function parseProviderField() {
      const field = cursor.expect(TOKEN.IDENT, 'a provider field');
      switch (field.value) {
        case 'secret': {
          const token = cursor.peek();
          if (token.type !== TOKEN.STRING && token.type !== TOKEN.HANDLE) {
            throw cursor.error('OMEGA_E_SECRET_LITERAL', 'a provider secret is a handle like `vault://gemini`; Ω has no syntax for a key', token);
          }
          cursor.next();
          provider.secret = token.value;
          provider.secretLoc = cursor.loc(token);
          return;
        }
        case 'strategy': {
          const strategy = cursor.expect(TOKEN.IDENT, '`cheapest`, `free` or `declared`');
          if (!['cheapest', 'free', 'declared'].includes(strategy.value)) {
            throw cursor.error('OMEGA_E_SCHEMA', `strategy must be cheapest, free or declared; found ${strategy.value}`, strategy);
          }
          provider.strategy = strategy.value;
          return;
        }
        case 'fallback':
          provider.fallback = this.parseStringList();
          return;
        case 'max_cost': {
          const cost = cursor.expect(TOKEN.INT, 'an integer cost ceiling');
          provider.maxCost = Number.parseInt(cost.value, 10);
          if (provider.maxCost < 0) throw cursor.error('OMEGA_E_SCHEMA', 'max_cost must be zero or positive', cost);
          return;
        }
        default:
          throw cursor.error('OMEGA_E_SCHEMA', `unknown provider field \`${field.value}\``, field);
      }
    });
    if (provider.secret === null) {
      throw cursor.error('OMEGA_E_SCHEMA', `provider ${name} has no \`secret\` handle; Ω never holds a literal key`, keyword);
    }
    return provider;
  }

  parseMission(keyword) {
    const cursor = this.cursor;
    const { name, loc } = this.parseName('mission');
    const mission = {
      kind: 'Mission',
      name,
      agent: null,
      goal: null,
      plan: [],
      requirements: [],
      statements: [],
      loc,
    };
    for (const item of this.parseBlock(`mission ${name}`, function parseMissionItem() {
      const token = cursor.peek();
      if (token.type !== TOKEN.IDENT) {
        throw cursor.error('OMEGA_E_PARSE', `expected a statement, found ${describeToken(token)}`, token);
      }
      switch (token.value) {
        case 'goal': {
          cursor.next();
          mission.goal = cursor.expect(TOKEN.STRING, 'the goal as a quoted string').value;
          return null;
        }
        case 'agent': {
          cursor.next();
          const agent = cursor.expect(TOKEN.IDENT, 'the acting agent');
          mission.agent = agent.value;
          return null;
        }
        case 'plan': {
          cursor.next();
          mission.plan = this.parsePlan();
          return null;
        }
        case 'require': {
          cursor.next();
          const what = cursor.expect(TOKEN.IDENT, '`capability` or `evidence`');
          if (what.value === 'capability') {
            mission.requirements.push({ kind: 'capability', capref: this.parseCapref(), loc: cursor.loc(what) });
            return null;
          }
          if (what.value === 'evidence') {
            const claim = cursor.expect(TOKEN.STRING, 'the required claim as a quoted string');
            mission.requirements.push({ kind: 'evidence', claim: claim.value, loc: cursor.loc(what) });
            return null;
          }
          throw cursor.error('OMEGA_E_SCHEMA', '`require` takes `capability <ref>` or `evidence "…"`', what);
        }
        default:
          mission.statements.push(this.parseStatement());
          return null;
      }
    })) {
      if (item !== null) mission.statements.push(item);
    }
    if (mission.goal === null) {
      throw cursor.error('OMEGA_E_SCHEMA', `mission ${name} has no goal`, keyword);
    }
    if (mission.agent === null) {
      throw cursor.error('OMEGA_E_SCHEMA', `mission ${name} does not name an acting agent`, keyword);
    }
    return mission;
  }

  /** `plan { analyze implement test }` — steps are words, separated by space, comma or newline. */
  parsePlan() {
    const cursor = this.cursor;
    cursor.expect(TOKEN.LBRACE, '`{` to open the plan');
    const steps = [];
    for (;;) {
      cursor.skipSeparators();
      if (cursor.check(TOKEN.RBRACE)) break;
      if (cursor.check(TOKEN.EOF)) throw cursor.error('OMEGA_E_PARSE', 'unterminated plan: missing `}`');
      const token = cursor.peek();
      if (token.type === TOKEN.STRING || token.type === TOKEN.IDENT) {
        steps.push(cursor.next().value);
        continue;
      }
      throw cursor.error('OMEGA_E_PARSE', `a plan step is a name or a quoted string, found ${describeToken(token)}`, token);
    }
    cursor.expect(TOKEN.RBRACE, '`}` to close the plan');
    return steps;
  }

  parseStatement() {
    const cursor = this.cursor;
    const token = cursor.expect(TOKEN.IDENT, 'a statement');
    const loc = cursor.loc(token);
    switch (token.value) {
      case 'let': {
        const name = cursor.expect(TOKEN.IDENT, 'a binding name');
        let type = null;
        if (cursor.match(TOKEN.COLON)) type = cursor.expect(TOKEN.IDENT, 'a type name').value;
        cursor.expect(TOKEN.EQ, '`=` in a `let`');
        const expr = this.parseExpression();
        return { kind: 'Let', name: name.value, type, expr, loc };
      }
      case 'set': {
        const name = cursor.expect(TOKEN.IDENT, 'a binding name');
        cursor.expect(TOKEN.EQ, '`=` in a `set`');
        return { kind: 'Set', name: name.value, expr: this.parseExpression(), loc };
      }
      case 'do': {
        const call = this.parseExpression();
        if (call.kind !== 'Call') {
          throw cursor.error('OMEGA_E_SCHEMA', '`do` must be followed by a call, e.g. `do echo.call(text: "hi")`', token);
        }
        let as = null;
        if (cursor.checkIdent('as')) {
          cursor.next();
          as = cursor.expect(TOKEN.IDENT, 'a binding name').value;
        }
        return { kind: 'Do', call, as, loc };
      }
      case 'observe': {
        const key = cursor.expect(TOKEN.IDENT, 'a world key');
        return { kind: 'Observe', key: key.value, loc };
      }
      case 'remember': {
        const name = cursor.expect(TOKEN.IDENT, 'a binding name');
        if (!cursor.checkIdent('as')) throw cursor.error('OMEGA_E_SCHEMA', '`remember x as <tier>`', cursor.peek());
        cursor.next();
        const tier = cursor.expect(TOKEN.IDENT, 'a memory tier');
        if (!MEMORY_TIERS.includes(tier.value)) {
          throw cursor.error('OMEGA_E_SCHEMA', `unknown memory tier \`${tier.value}\``, tier);
        }
        return { kind: 'Remember', name: name.value, tier: tier.value, loc };
      }
      case 'recall': {
        const tier = cursor.expect(TOKEN.IDENT, 'a memory tier');
        if (!MEMORY_TIERS.includes(tier.value)) {
          throw cursor.error('OMEGA_E_SCHEMA', `unknown memory tier \`${tier.value}\``, tier);
        }
        if (!cursor.checkIdent('as')) throw cursor.error('OMEGA_E_SCHEMA', '`recall <tier> as <name>`', cursor.peek());
        cursor.next();
        const name = cursor.expect(TOKEN.IDENT, 'a binding name');
        return { kind: 'Recall', tier: tier.value, name: name.value, loc };
      }
      case 'seal': {
        const name = cursor.expect(TOKEN.IDENT, 'a binding name');
        return { kind: 'Seal', name: name.value, loc };
      }
      case 'assert': {
        if (cursor.check(TOKEN.IDENT) && cursor.peek(1).type === TOKEN.IDENT && cursor.peek(1).value === 'is') {
          const name = cursor.next();
          cursor.next();
          const type = cursor.expect(TOKEN.IDENT, 'a type name');
          return { kind: 'AssertType', name: name.value, type: type.value, loc };
        }
        const left = this.parseExpression();
        const operator = cursor.peek();
        if (TOKEN_FOR_OP[operator.value] === undefined || operator.type !== TOKEN_FOR_OP[operator.value]) {
          throw cursor.error('OMEGA_E_SCHEMA', '`assert` compares with ==, !=, <, <=, > or >=', operator);
        }
        cursor.next();
        const right = this.parseExpression();
        return { kind: 'Assert', left, op: operator.value, right, loc };
      }
      case 'evidence': {
        const claim = cursor.expect(TOKEN.IDENT, '`claim`');
        if (claim.value !== 'claim') {
          throw cursor.error('OMEGA_E_SCHEMA', 'the only evidence statement is `evidence claim "…" [from x]`', claim);
        }
        const text = cursor.expect(TOKEN.STRING, 'the claim text');
        let from = null;
        if (cursor.checkIdent('from')) {
          cursor.next();
          from = cursor.expect(TOKEN.IDENT, 'a verified binding name').value;
        }
        return { kind: 'Evidence', claim: text.value, from, loc };
      }
      case 'emit': {
        return { kind: 'Emit', expr: this.parseExpression(), loc };
      }
      case 'if': {
        const cond = this.parseExpression();
        const then = this.parseBlock('a block', function parseThen() { return this.parseStatement(); });
        let otherwise = [];
        const mark = cursor.index;
        cursor.skipSeparators();
        if (cursor.checkIdent('else')) {
          cursor.next();
          otherwise = this.parseBlock('an else block', function parseElse() { return this.parseStatement(); });
        } else {
          cursor.index = mark;
        }
        return { kind: 'If', cond, then, else: otherwise, loc };
      }
      case 'fail': {
        const reason = cursor.expect(TOKEN.STRING, 'the reason as a quoted string');
        return { kind: 'Fail', reason: reason.value, loc };
      }
      default:
        throw cursor.error('OMEGA_E_PARSE', `unknown statement \`${token.value}\``, token);
    }
  }

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    const cursor = this.cursor;
    let left = this.parseAnd();
    while (cursor.checkIdent('or')) {
      const loc = cursor.loc(cursor.next());
      left = { kind: 'Binary', op: 'or', left, right: this.parseAnd(), loc };
    }
    return left;
  }

  parseAnd() {
    const cursor = this.cursor;
    let left = this.parseNot();
    while (cursor.checkIdent('and')) {
      const loc = cursor.loc(cursor.next());
      left = { kind: 'Binary', op: 'and', left, right: this.parseNot(), loc };
    }
    return left;
  }

  parseNot() {
    const cursor = this.cursor;
    if (cursor.checkIdent('not')) {
      const token = cursor.next();
      return { kind: 'Not', expr: this.parseNot(), loc: cursor.loc(token) };
    }
    return this.parseComparison();
  }

  parseComparison() {
    const cursor = this.cursor;
    const left = this.parseAdditive();
    const token = cursor.peek();
    if (COMPARISON_OPS.includes(token.value) && token.type === TOKEN_FOR_OP[token.value]) {
      cursor.next();
      return { kind: 'Binary', op: token.value, left, right: this.parseAdditive(), loc: cursor.loc(token) };
    }
    return left;
  }

  parseAdditive() {
    const cursor = this.cursor;
    let left = this.parsePrimary();
    while (cursor.check(TOKEN.PLUS) || cursor.check(TOKEN.MINUS)) {
      const token = cursor.next();
      left = { kind: 'Binary', op: token.value, left, right: this.parsePrimary(), loc: cursor.loc(token) };
    }
    return left;
  }

  parsePrimary() {
    const cursor = this.cursor;
    const token = cursor.peek();
    if (token.type === TOKEN.INT) {
      cursor.next();
      return { kind: 'Literal', type: 'number', value: Number.parseInt(token.value, 10), loc: cursor.loc(token) };
    }
    if (token.type === TOKEN.STRING) {
      cursor.next();
      return { kind: 'Literal', type: 'string', value: token.value, loc: cursor.loc(token) };
    }
    if (token.type === TOKEN.IDENT && token.value === 'untaint') {
      // `untaint x as VerifiedData via sanitizer.redact(text: "…")` is an expression:
      // a declassification produces a value, and a value is bound explicitly.
      cursor.next();
      const name = cursor.expect(TOKEN.IDENT, 'the binding to declassify');
      if (!cursor.checkIdent('as')) throw cursor.error('OMEGA_E_SCHEMA', '`untaint x as <Type> via <sanitizer call>`', cursor.peek());
      cursor.next();
      const type = cursor.expect(TOKEN.IDENT, 'the target type');
      if (!cursor.checkIdent('via')) throw cursor.error('OMEGA_E_SCHEMA', '`untaint` needs `via <sanitizer call>`', cursor.peek());
      cursor.next();
      const call = this.parseExpression();
      if (call.kind !== 'Call') {
        throw cursor.error('OMEGA_E_SCHEMA', '`via` takes a call, e.g. `via sanitizer.redact(text: "ok")`', token);
      }
      return { kind: 'Untaint', name: name.value, type: type.value, call, loc: cursor.loc(token) };
    }
    if (token.type === TOKEN.IDENT) {
      if (token.value === 'true' || token.value === 'false') {
        cursor.next();
        return { kind: 'Literal', type: 'bool', value: token.value === 'true', loc: cursor.loc(token) };
      }
      if (cursor.peek(1).type === TOKEN.LPAREN) {
        cursor.next();
        cursor.next();
        const args = [];
        for (;;) {
          while (cursor.check(TOKEN.NEWLINE)) cursor.next();
          if (cursor.check(TOKEN.RPAREN)) break;
          args.push(this.parseArgument());
          while (cursor.check(TOKEN.NEWLINE)) cursor.next();
          if (cursor.check(TOKEN.COMMA)) {
            cursor.next();
            continue;
          }
          break;
        }
        while (cursor.check(TOKEN.NEWLINE)) cursor.next();
        cursor.expect(TOKEN.RPAREN, '`)` to close the call');
        return { kind: 'Call', path: token.value, args, loc: cursor.loc(token) };
      }
      cursor.next();
      return { kind: 'Name', name: token.value, loc: cursor.loc(token) };
    }
    throw cursor.error('OMEGA_E_PARSE', `expected an expression, found ${describeToken(token)}`, token);
  }

  parseArgument() {
    const cursor = this.cursor;
    const token = cursor.peek();
    if (token.type === TOKEN.IDENT && cursor.peek(1).type === TOKEN.COLON) {
      cursor.next();
      cursor.next();
      return { name: token.value, expr: this.parseExpression(), loc: cursor.loc(token) };
    }
    return { name: null, expr: this.parseExpression(), loc: cursor.loc(token) };
  }

  parseEvolve(keyword) {
    const cursor = this.cursor;
    const token = cursor.expect(TOKEN.IDENT, 'a module name to evolve');
    if (RESERVED_WORDS.has(token.value)) {
      throw cursor.error('OMEGA_E_SCHEMA', `\`${token.value}\` is a reserved word and cannot name a module`, token);
    }
    const proposal = {
      kind: 'Evolve',
      module: token.value,
      from: null,
      to: null,
      hypothesis: null,
      expects: [],
      loc: cursor.loc(token),
    };
    this.parseBlock(`evolve ${proposal.module}`, function parseEvolveField() {
      const field = cursor.expect(TOKEN.IDENT, 'an evolve field');
      switch (field.value) {
        case 'from':
          proposal.from = cursor.expect(TOKEN.STRING, 'the parent version').value;
          return;
        case 'to':
          proposal.to = cursor.expect(TOKEN.STRING, 'the candidate version').value;
          return;
        case 'hypothesis':
          proposal.hypothesis = cursor.expect(TOKEN.STRING, 'the hypothesis').value;
          return;
        case 'expect': {
          const metric = cursor.expect(TOKEN.STRING, 'a metric name');
          const opToken = cursor.peek();
          if (!COMPARISON_OPS.includes(opToken.value) || opToken.type !== TOKEN_FOR_OP[opToken.value]) {
            throw cursor.error('OMEGA_E_SCHEMA', 'an expectation compares a metric with ==, !=, <, <=, > or >=', opToken);
          }
          cursor.next();
          const sign = cursor.match(TOKEN.MINUS) ? -1 : 1;
          const valueToken = cursor.expect(TOKEN.INT, 'an integer expectation');
          proposal.expects.push({ metric: metric.value, op: opToken.value, value: sign * Number.parseInt(valueToken.value, 10) });
          return;
        }
        default:
          throw cursor.error('OMEGA_E_SCHEMA', `unknown evolve field \`${field.value}\``, field);
      }
    });
    if (proposal.from === null || proposal.to === null) {
      throw cursor.error('OMEGA_E_SCHEMA', `evolve ${proposal.module} needs both \`from\` and \`to\``, keyword);
    }
    if (proposal.hypothesis === null) {
      throw cursor.error('OMEGA_E_SCHEMA', `evolve ${proposal.module} needs a \`hypothesis\``, keyword);
    }
    return proposal;
  }
}

/**
 * @param {string} source
 * @param {{path?: string}} [options]
 * @returns {object} the Program node
 */
export function parseProgram(source, { path = '<source>' } = {}) {
  return new Parser(source, { path }).parse();
}
