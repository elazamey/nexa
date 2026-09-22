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
