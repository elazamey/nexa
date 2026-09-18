/**
 * Capability reference resolution and scope algebra.
 *
 * One function turns a capref (at a call site, in an allow-list, or in a grant) into
 * `(resource, action)`. Using the *same* function everywhere is what makes "the agent
 * allows this call" a checkable statement instead of a convention.
 *
 * Scope matching is glob-based for patterns and exact for call sites, and coverage
 * between two patterns is proven conservatively: when Ω cannot prove that every
 * resource matching the required pattern is also matched by the grant, the answer is
 * no. Default-deny applies to the compiler too.
 */
import { OmegaError } from './errors.js';

/**
 * Builtin namespaces. `path: true` means the resource id carries a filesystem-ish
 * path and therefore *requires* a scope; the others accept an optional scope that
 * names the specific sub-resource (e.g. `memory.read("episodic")`).
 */
export const BUILTIN_NAMESPACES = Object.freeze({
  fs: { path: true, trust: 'untrusted', actions: ['read', 'list', 'stat', 'write', 'delete', 'move'] },
  net: { path: true, trust: 'untrusted', actions: ['get', 'post'] },
  tool: { path: false, trust: 'untrusted', actions: ['call'] },
  mcp: { path: false, trust: 'untrusted', actions: ['call'] },
  sanitizer: { path: false, trust: 'verified', accepts_secret: true, actions: ['redact', 'strip_markup', 'to_public'] },
  evidence: { path: false, trust: 'verified', actions: ['create'] },
  memory: { path: false, trust: 'internal', actions: ['read', 'store'] },
  model: { path: false, trust: 'untrusted', accepts_secret: true, actions: ['invoke'] },
  world: { path: false, trust: 'internal', actions: ['read'] },
  secrets: { path: false, trust: 'internal', actions: ['load'] },
});

/** Namespaces a module may not use as an instrument (they exist only for tooling). */
export const RESERVED_NAMESPACES = Object.freeze(['kernel', 'omega']);

const RESOURCE_RE = /^[a-z][a-z0-9_-]{0,31}:[a-z0-9/._*-]{1,127}$/;
const ACTION_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const KERNEL_RESOURCE_RE = /^[a-z][a-z0-9_-]{0,31}:[a-z0-9/._-]{1,127}$/;

/** @param {string} value */
export function isResource(value) {
  return typeof value === 'string' && RESOURCE_RE.test(value);
}

/** A resource the kernel will accept: no wildcards at all. @param {string} value */
export function isConcreteResource(value) {
  return typeof value === 'string' && KERNEL_RESOURCE_RE.test(value);
}

/** @param {string} value */
export function hasWildcard(value) {
  return typeof value === 'string' && value.includes('*');
}

/** @param {string} pattern @returns {string} a scope glob as a regular expression source */
function globToRegExpSource(pattern) {
  let out = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        out += '[\\s\\S]*'; // `**` crosses separators
        index += 1;
      } else {
        out += '[^/]*'; // `*` stays inside one segment
      }
      continue;
    }
    out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return `^${out}$`;
}

/**
 * @param {string} pattern a scope glob, e.g. `/src/**`
 * @param {string} value a concrete scope, e.g. `/src/main.js`
 * @returns {boolean}
 */
export function matchScope(pattern, value) {
  if (typeof pattern !== 'string' || typeof value !== 'string') return false;
  if (pattern === value) return true;
  if (pattern === '**' || pattern === '*') return true;
  if (!hasWildcard(pattern)) return false;
  return new RegExp(globToRegExpSource(pattern), 'u').test(value);
}

/** @param {string} resourcePattern e.g. `fs:/src/**` @param {string} resource e.g. `fs:/src/a.js` */
export function matchResource(resourcePattern, resource) {
  if (typeof resourcePattern !== 'string' || typeof resource !== 'string') return false;
  if (resourcePattern === resource) return true;
  const colon = resourcePattern.indexOf(':');
  if (colon === -1) return false;
  const namespace = resourcePattern.slice(0, colon);
  const scope = resourcePattern.slice(colon + 1);
  if (!resource.startsWith(`${namespace}:`)) return false;
  return matchScope(scope, resource.slice(colon + 1));
}

/**
 * Conservative pattern coverage: is every resource matched by `required` also matched
 * by `granted`? A `false` here does not mean the grant is wrong — it means Ω cannot
 * prove it, and Ω does not guess.
 * @param {string} granted a pattern
 * @param {string} required a pattern or a concrete resource
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function coversResource(granted, required) {
  if (typeof granted !== 'string' || typeof required !== 'string') {
    return { ok: false, reason: 'coverage needs two strings' };
  }
  if (!hasWildcard(required)) {
    return matchResource(granted, required)
      ? { ok: true }
      : { ok: false, reason: `granted scope ${granted} does not cover ${required}` };
  }
  if (granted === required) return { ok: true };
  const grantedNs = granted.slice(0, granted.indexOf(':'));
  const requiredNs = required.slice(0, required.indexOf(':'));
  if (grantedNs !== requiredNs) {
    return { ok: false, reason: `different namespaces: ${grantedNs} vs ${requiredNs}` };
  }
  const grantedScope = granted.slice(granted.indexOf(':') + 1);
  const requiredScope = required.slice(required.indexOf(':') + 1);
  if (grantedScope === '**' || grantedScope === '*') return { ok: true };
  // `…/base/**` covers any required pattern that lives below `base`.
  const suffix = requiredScope.endsWith('/**') ? requiredScope.slice(0, -3) : null;
  if (suffix !== null && !hasWildcard(suffix)) {
    if (grantedScope === `${suffix}/**` || grantedScope === suffix) return { ok: true };
    if (matchScope(grantedScope, suffix)) return { ok: true };
    if (grantedScope.endsWith('/**') && matchScope(grantedScope, `${suffix}/probe`)) return { ok: true };
  }
  return {
    ok: false,
    reason: `cannot prove that ${granted} covers ${required}; narrow the request or widen the grant`,
  };
}

/** @param {string} resource @returns {string} the namespace */
export function namespaceOf(resource) {
  const colon = resource.indexOf(':');
  return colon === -1 ? resource : resource.slice(0, colon);
}

/**
 * @param {object} env
 * @param {Map<string, object>} env.instruments declared instruments by name
 * @param {Map<string, object>} env.servers declared MCP servers by name
 * @param {object} capref
 * @param {boolean} [capref.pattern] allow wildcards (allow-lists and grants) or not (call sites)
 * @returns {{resource: string, actions: string[], origin: string, trust: string, accepts_secret: boolean, action_secret_ok: boolean}}
 */
export function resolveCapref(env, capref, { pattern = false } = {}) {
  const at = capref.loc ?? null;
  const fail = (code, message, details) => {
    throw new OmegaError(code, message, { ...(details ?? {}), ...(at === null ? {} : { line: at.line, column: at.column }) });
  };

  // 1. explicit form: `resource "tool:echo" call`
  if (capref.resource !== undefined) {
    if (!isResource(capref.resource) || hasWildcard(capref.resource)) {
      fail('OMEGA_E_SCHEMA', `invalid resource id: ${String(capref.resource)}`);
    }
    const actions = capref.actions ?? ['call'];
    for (const action of actions) {
      if (!ACTION_RE.test(action)) fail('OMEGA_E_SCHEMA', `invalid action: ${String(action)}`);
    }
    return {
      resource: capref.resource,
      actions: [...new Set(actions)].sort(),
      origin: 'explicit',
      trust: BUILTIN_NAMESPACES[namespaceOf(capref.resource)]?.trust ?? 'untrusted',
      accepts_secret: false,
    };
  }

  const path = capref.path;
  if (typeof path !== 'string' || path.length === 0) fail('OMEGA_E_SCHEMA', 'capability reference is empty');
  const segments = path.split('.');
  const head = segments[0];

  if (RESERVED_NAMESPACES.includes(head)) {
    fail('OMEGA_E_UNKNOWN_INSTRUMENT', `namespace "${head}" is reserved and is not an instrument`);
  }

  // 2. a declared instrument: longest name that matches, the rest is the action
  let instrument = null;
  for (let take = segments.length; take >= 1; take -= 1) {
    const name = segments.slice(0, take).join('.');
    if (env.instruments.has(name)) {
      instrument = env.instruments.get(name);
      const rest = segments.slice(take);
      if (rest.length > 1) fail('OMEGA_E_UNKNOWN_INSTRUMENT', `${path} is not a valid action on instrument ${name}`);
      const action = rest.length === 0 ? 'call' : rest[0];
      if (!instrument.actions.includes(action)) {
        fail('OMEGA_E_UNKNOWN_INSTRUMENT', `instrument ${name} does not declare action "${action}"`, { actions: instrument.actions });
      }
      if (capref.scope !== undefined) {
        fail('OMEGA_E_SCHEMA', `instrument ${name} is bound to ${instrument.resource}; a scope cannot be added here`);
      }
      return {
        resource: instrument.resource,
        actions: [action],
        origin: 'instrument',
        trust: instrument.trust,
        accepts_secret: instrument.acceptsSecret === true,
      };
    }
  }

  // 3. a declared MCP server: `github.repository.read`
  if (env.servers.has(head)) {
    const server = env.servers.get(head);
    if (segments.length < 2) fail('OMEGA_E_UNKNOWN_INSTRUMENT', `${head} is an MCP server, not a tool: name a tool`);
    const tool = segments.slice(1).join('.');
    if (!server.tools.includes(tool)) {
      fail('OMEGA_E_UNKNOWN_INSTRUMENT', `MCP server ${head} does not declare tool "${tool}"`, { declared: server.tools });
    }
    if (capref.scope !== undefined) {
      fail('OMEGA_E_SCHEMA', 'an MCP tool takes arguments, not a scope');
    }
    return {
      resource: `mcp:${head}.${tool}`,
      actions: ['call'],
      origin: 'mcp',
      trust: 'untrusted',
      accepts_secret: false,
    };
  }

  // 4. a builtin namespace
  if (Object.hasOwn(BUILTIN_NAMESPACES, head)) {
    const namespace = BUILTIN_NAMESPACES[head];
    if (segments.length === 1) fail('OMEGA_E_UNKNOWN_INSTRUMENT', `${head} needs an action, e.g. ${head}.${namespace.actions[0]}`);
    if (segments.length > 2) fail('OMEGA_E_UNKNOWN_INSTRUMENT', `${path} has too many segments`);
    const action = segments[1];
    if (!namespace.actions.includes(action)) {
      fail('OMEGA_E_UNKNOWN_INSTRUMENT', `namespace ${head} has no action "${action}"`, { actions: namespace.actions });
    }
    if (namespace.path) {
      if (capref.scope === undefined) {
        fail('OMEGA_E_CAP_MISSING', `${path} requires a scope, e.g. ${path}("/some/path")`);
      }
      if (capref.scope.length === 0 || capref.scope[0] !== '/') {
        fail('OMEGA_E_SCHEMA', `${head} scopes are absolute paths and must start with "/"`);
      }
      const resource = `${head}:${capref.scope}`;
      if (!isResource(resource)) fail('OMEGA_E_SCHEMA', `invalid resource: ${resource}`);
      if (!pattern && hasWildcard(resource)) {
        fail('OMEGA_E_RESOURCE_WILDCARD', `a call site cannot use a wildcard resource: ${resource}`);
      }
      return { resource, actions: [action], origin: 'builtin', trust: namespace.trust, accepts_secret: false };
    }
    if (capref.scope !== undefined) {
      const resource = `${head}:${capref.scope}`;
      if (!isResource(resource)) fail('OMEGA_E_SCHEMA', `invalid resource: ${resource}`);
      if (!pattern && hasWildcard(resource)) {
        fail('OMEGA_E_RESOURCE_WILDCARD', `a call site cannot use a wildcard resource: ${resource}`);
      }
      return { resource, actions: [action], origin: 'builtin', trust: namespace.trust, accepts_secret: namespace.accepts_secret === true };
    }
    // No scope: in a pattern this covers the whole namespace; at a call site it is the
    // canonical resource for that action (`sanitizer.redact` → `sanitizer:redact`).
    if (!pattern) {
      return {
        resource: `${head}:${action}`,
        actions: [action],
        origin: 'builtin',
        trust: namespace.trust,
        accepts_secret: namespace.accepts_secret === true,
      };
    }
    return {
      resource: `${head}:*`,
      actions: [action],
      origin: 'builtin',
      trust: namespace.trust,
      accepts_secret: namespace.accepts_secret === true,
    };
  }

  fail('OMEGA_E_UNKNOWN_INSTRUMENT', `${path} does not resolve to an instrument, an MCP tool or a builtin namespace`);
  return null; // unreachable
}

/**
 * Does an allow-list entry (patterns) cover a concrete call site?
 * @param {{resource: string, actions: string[]}} granted
 * @param {{resource: string, actions: string[]}} required
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function coversCall(granted, required) {
  const coverage = coversResource(granted.resource, required.resource);
  if (!coverage.ok) return coverage;
  const allowed = new Set(granted.actions);
  const missing = required.actions.filter((action) => !allowed.has(action));
  if (missing.length > 0) {
    return { ok: false, reason: `action(s) not allowed: ${missing.join(', ')}` };
  }
  return { ok: true };
}
