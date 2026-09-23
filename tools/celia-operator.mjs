/**
 * tools/celia-operator.mjs — the signing identity of this deployment's human seat.
 *
 * v13-1 made "the operator at this dashboard" the trusted approver, and did it
 * with a *published* seed: `createIdentity({ seed: 'e5'.repeat(32) })` is in the
 * source, so the kid is derivable by anyone who can read the repository. D1.10
 * layer 4 separates two things that were conflated:
 *
 *   • the perimeter secret (NEXA_API_KEY)   — who may reach the transport
 *   • the operator key (this file)          — who may sign an approval decision
 *
 * Neither implies the other. Fixing the contract does not require a new secret:
 * with the default seed left in place, a `POST .../approve {}` is still refused,
 * because `{}` is not a decision — it carries no approver, no scope and no
 * signature. Rotation (NEXA_OPERATOR_SEED) is what makes the *id* private, and is
 * warned about at boot in production (tools/celia-startup-guard.mjs), never forced,
 * so no deployment that pinned the documented seed breaks on this commit.
 */
import { createIdentity } from '../packages/identity/index.js';

/** The published demo seed — public by definition, kept for compatibility. */
export const DEMO_OPERATOR_SEED = 'e5'.repeat(32);

/**
 * @param {{env?: Record<string,string|undefined>, label?: string}} [options]
 * @returns {{kid: string, keys: import('../packages/crypto/index.js').KeyPair,
 *            label: string, usingDemoSeed: boolean}}
 */
export function createDashboardOperator({ env = process.env, label = 'celia-dashboard-operator' } = {}) {
  const configured = typeof env.NEXA_OPERATOR_SEED === 'string' ? env.NEXA_OPERATOR_SEED.trim() : '';
  const seed = configured.length > 0 ? configured : DEMO_OPERATOR_SEED;
  const identity = createIdentity({ label, seed });
  return {
    kid: identity.kid,
    keys: identity.keys,
    label,
    usingDemoSeed: seed === DEMO_OPERATOR_SEED,
  };
}
