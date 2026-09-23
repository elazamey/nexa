/**
 * tools/celia-startup-guard.mjs — D1.10 / P0-B layer 3: production refuses to
 * boot with an open perimeter.
 *
 * Why a startup guard and not a request-time one: "works locally, fails silently
 * in production" is the exact failure family this whole track is closing (O02/O03).
 * A wall that is configured by omission must be loud at the moment of omission,
 * before it has served a single mutating request — an operator should never find
 * out from an incident that the deployment came up unauthenticated.
 *
 * The rule is deliberately narrow, so it cannot become a footgun:
 *
 *   production (NODE_ENV=production or NEXA_ENV=production)
 *     AND NEXA_API_KEY missing/empty/whitespace   → refuse to start (exit 1)
 *   anything else (local, dev, test, CI)          → no opinion, boot as today
 *
 * No other signal is consulted on purpose: keys, ports, SUPABASE_* (that is
 * D1.11's job) and the demo operator seed all stay out of this check, so this
 * file can never be the reason a green dev run stops being green.
 *
 * This is a perimeter statement, not a policy decision: it refuses to serve
 * without an authentication secret. It grants nothing and approves nothing.
 *
 * D1.11 adds a sibling verdict here (continuity of the memory backend) under the
 * same rule: refuse at startup, deterministically, before any listener exists.
 */
import { isProductionRuntime, normalizeApiKey } from './celia-perimeter-auth.mjs';

export const STARTUP_GUARD_VERSION = 'nexa:startup-guard:v1';

/**
 * @param {{env?: Record<string,string|undefined>, required?: boolean}} [options]
 *   `required` wins when supplied by the caller (the perimeter already normalised
 *   the secret once); the env path exists so this check is testable standalone.
 * @returns {{ok: true, production: boolean}|{ok: false, code: string, message: string, production: true}}
 */
export function assertProductionPerimeter(options = {}) {
  const env = options.env ?? process.env;
  const production = options.production === undefined
    ? isProductionRuntime(env)
    : options.production === true;
  if (!production) return { ok: true, production: false };

  const required = options.required === undefined
    ? normalizeApiKey(env.NEXA_API_KEY) !== null
    : options.required === true;
  if (required) return { ok: true, production: true };

  const message = [
    'NEXA startup refused: production runtime with no HTTP perimeter credential.',
    'Every /api/* route (authorizations/request, approve, terminal/execute, workspace',
    'write/commit, semantic/governed stores) mutates state; serving them unauthenticated',
    'is the failure this guard exists to make impossible.',
    'Set NEXA_API_KEY to a secret of at least 32 chars (operator/CLI credential; the',
    'browser SPA then authenticates with an HttpOnly session cookie), or run this',
    'process outside production (NODE_ENV/NEXA_ENV) if it is not a deployment.',
  ].join('\n  ');
  return { ok: false, code: 'NEXA_E_PERIMETER_UNCONFIGURED', message, production: true };
}

/**
 * === D1.11 (O03) — continuity: production does not boot on an ephemeral backend ===
 *
 * Why this guard decides from the PORT'S verdict and not from the shape of the
 * config: `tools/celia-vector-port.mjs` falls back to a mock adapter whenever the
 * driver is unavailable — a *real-looking* SUPABASE_URL with an unreachable or
 * uninstalled client ends up on `mock://memory` and says nothing about it. A
 * config check would therefore certify exactly the case it must refuse: a
 * deployment that claims continuity while every write dies with the process.
 * So the order of evidence is: what the port reports (authoritative) → what the
 * config claimed (used to name the reason) → what production asserts (fatal).
 *
 * The one legal way through is an explicit, exactly-spelled acknowledgment:
 *
 *   NEXA_PRODUCTION_PERSISTENCE=ack-mock-ephemeral
 *
 * That is not an off-switch, and the difference from the perimeter guard is
 * principled, not stylistic:
 *   • perimeter (D1.10): serving unauthenticated mutating routes is *unsafe*, and
 *     no operator sentence makes it safe ⇒ no override exists.
 *   • continuity (D1.11): running an ephemeral backend is *not a claim*, as long
 *     as nobody says "persistent". The operator may accept ephemerality for a
 *     demo deploy; what is forbidden is the false claim. So the ack is accepted,
 *     logged loudly, and mirrored in /api/v1/system/status as `memory: DEMO`.
 * Anything other than the exact value (including "1", "yes", or a trailing
 * space) is not an acknowledgment — absence/ambiguity of a decision is not a
 * decision, the same axiom that closed approve({}).
 *
 * Out of scope by the ticket, deliberately: no Supabase refactor, no persistent
 * storage implementation, no Render migration, no server decomposition. This
 * module only refuses to start; it never repairs.
 */

/** The fallback the vector port itself uses — kept in one place (see resolvePersistenceBackend). */
export const MOCK_PERSISTENCE_URL = 'mock://memory';
export const MOCK_PERSISTENCE_KEY = 'mock-key';
export const PERSISTENCE_ACK = 'ack-mock-ephemeral';
export const PERSISTENCE_MOCK_CODE = 'NEXA_E_PERSISTENCE_MOCK';

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve the same url/key the semantic-memory port will receive. The server must
 * build the port from this object's output, so the guard can never inspect a
 * different value than the one that was used (the drift this function exists to
 * remove).
 * @param {{env?: Record<string,string|undefined>}} [options]
 * @returns {{url: string, key: string, source: 'SUPABASE_URL'|'default-mock', claimedReal: boolean}}
 */
export function resolvePersistenceBackend({ env = process.env } = {}) {
  const url = configured(env.SUPABASE_URL) ?? MOCK_PERSISTENCE_URL;
  const key = configured(env.SUPABASE_ANON_KEY) ?? configured(env.SUPABASE_SERVICE_KEY) ?? MOCK_PERSISTENCE_KEY;
  // Mirrors the port's own acceptance test (mock/demo hosts are never real) so
  // "looks real here" and "will be real there" cannot disagree.
  const claimedReal = url !== MOCK_PERSISTENCE_URL
    && !url.includes('mock')
    && !url.includes('demo')
    && key !== MOCK_PERSISTENCE_KEY;
  return { url, key, source: url === MOCK_PERSISTENCE_URL ? 'default-mock' : 'SUPABASE_URL', claimedReal };
}

/**
 * @param {{env?: Record<string,string|undefined>, backend?: object, realBackend?: boolean}} options
 *   `realBackend` is the port's own verdict (`_isMock === false`), not a guess.
 * @returns {{ok: true, production: boolean, real?: boolean, acknowledged?: boolean, warning?: string}
 *          | {ok: false, production: true, code: string, reason: string, message: string}}
 */
export function assertProductionPersistence({ env = process.env, backend, realBackend = false } = {}) {
  if (!isProductionRuntime(env)) return { ok: true, production: false };
  if (realBackend === true) return { ok: true, production: true, real: true, acknowledged: false };

  const resolved = backend ?? resolvePersistenceBackend({ env });
  const reason = resolved.claimedReal ? 'no-driver'
    : resolved.source === 'SUPABASE_URL' ? 'mock-url' : 'unconfigured';
  if (env.NEXA_PRODUCTION_PERSISTENCE === PERSISTENCE_ACK) {
    return {
      ok: true,
      production: true,
      real: false,
      acknowledged: true,
      warning: [
        'NEXA production is running an EPHEMERAL memory backend (mock://memory): semantic',
        'and governed facts are lost on every restart and are not shared across',
        'replicas. Acknowledged by NEXA_PRODUCTION_PERSISTENCE, so /api/v1/system/status',
        'reports memory as DEMO — this deployment must not be described as persistent.',
      ].join(' '),
    };
  }

  const fix = reason === 'no-driver'
    ? 'The configured SUPABASE_URL looks real, but the port fell back to its mock adapter'
      + ' (no usable pgvector driver in this install). A real-looking URL with a silent'
      + ' mock fallback is the exact claim this guard exists to refuse.'
    : 'Set SUPABASE_URL plus SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY) to a reachable'
      + ' backend, and make sure the port can construct it — the driver must exist, not'
      + ' just the URL.';
  const message = [
    `NEXA startup refused: production runtime whose continuity backend is mock (${reason}).`,
    `The semantic-memory port resolved to ${MOCK_PERSISTENCE_URL}: every store, recall`,
    'and governed-memory write lives in this process and disappears on restart, while',
    'the deployment labels itself production.',
    fix,
    'If ephemerality is what you actually want here, acknowledge it explicitly:',
    `  NEXA_PRODUCTION_PERSISTENCE=${PERSISTENCE_ACK}`,
    '(that label is reported as DEMO in /api/v1/system/status — it buys honesty, not',
    'persistence). Or run this process outside production if it is not a deployment.',
  ].join('\n  ');
  return { ok: false, production: true, code: PERSISTENCE_MOCK_CODE, reason, message };
}

/**
 * Production should not sign approvals with the public demo seed. Warned, never
 * fatal: a second fail-fast here would brick every existing deploy that pinned
 * the documented seed, and D1.10 is about the perimeter, not key rotation.
 * @returns {string|null} warning text when the seed is the public default
 */
export function operatorSeedWarning(env = process.env) {
  if (!isProductionRuntime(env)) return null;
  const seed = typeof env.NEXA_OPERATOR_SEED === 'string' ? env.NEXA_OPERATOR_SEED.trim() : '';
  if (seed.length > 0) return null;
  return [
    'NEXA warning: production is signing approvals with the published demo operator',
    'seed. The perimeter key protects the transport, but any clone of this repo can',
    'derive that key id. Set NEXA_OPERATOR_SEED to a private 32-byte hex seed.',
  ].join(' ');
}
