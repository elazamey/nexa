/**
 * The adversarial suite — the stage that tries to break the candidate.
 *
 * A verification stage that only asks "does it work" is a smoke test. This one runs
 * attacks, in the categories the design names, and requires that every one of them be
 * *blocked*: an attack that succeeds is a finding, and a finding quarantines.
 *
 * Note where the judgement lives. The caller executes the attacks and reports what
 * happened; the *gate* re-counts the reports itself and refuses a summary that does not
 * add up. A candidate cannot pass this stage by declaring that it passed.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_ADVERSARIAL_DOMAIN = 'NEXA/omega1 adversarial\0';

/**
 * Attack categories. Every one of these must have been attempted, at least once.
 *
 * `kernel-self-modification` was added with the cellular layer: making a cell out of a
 * kernel module was a new way to try to evolve the un-evolvable, and a category that is
 * not attempted is a class of attack nobody is looking for.
 *
 * `identity-forgery` was added with the Google organ, and it is the first category that
 * arrives from outside NEXA: everything else here assumes the attacker is inside the
 * system, while these attacks begin with a token the provider itself would have signed.
 * An identity that is *proved* by someone else is a new way in, so it gets its own class
 * of attempts rather than being filed under `invalid-signature`.
 */
export const ATTACK_CATEGORIES = Object.freeze([
  'capability-escalation',
  'secret-exfiltration',
  'replay',
  'tampering',
  'invalid-signature',
  'scope-widening',
  'resource-exhaustion',
  'policy-bypass',
  'tool-confusion',
  'untrusted-to-evidence',
  'kernel-self-modification',
  'identity-forgery',
]);

/** How many attacks a suite must contain before it is credible. */
export const MIN_ATTACKS = ATTACK_CATEGORIES.length;

/**
 * @param {{id: string, category: string, description?: string, run: () => {blocked: boolean, code?: string}}} input
 * @returns {object} an attack definition
 */
export function createAttack({ id, category, description = '', run }) {
  if (typeof id !== 'string' || id.length === 0) throw new OmegaError('OMEGA_E_ADVERSARIAL', 'an attack needs an id');
  if (!ATTACK_CATEGORIES.includes(category)) {
    throw new OmegaError('OMEGA_E_ADVERSARIAL', `unknown attack category: ${String(category)}`, { known: [...ATTACK_CATEGORIES] });
  }
  if (typeof run !== 'function') throw new OmegaError('OMEGA_E_ADVERSARIAL', `attack ${id} needs a run function`);
  return { id, category, description, run };
}

/**
 * Execute a suite of attacks. An attack "blocks" when the system refuses it with a
 * modelled error code; an attack that throws something unmodelled is *not* blocked —
 * an unhandled failure is exactly the kind of finding this stage exists to catch.
 *
 * @param {object[]} attacks
 * @returns {object[]} one report per attack
 */
export function runAttacks(attacks) {
  if (!Array.isArray(attacks)) throw new OmegaError('OMEGA_E_ADVERSARIAL', 'attacks must be an array');
  const reports = [];
  for (const attack of attacks) {
    try {
      const outcome = attack.run();
      reports.push({
        id: attack.id,
        category: attack.category,
        blocked: outcome?.blocked === true,
        code: outcome?.code ?? null,
        detail: outcome?.detail ?? null,
      });
    } catch (cause) {
      const modelled = typeof cause?.code === 'string' && /^(OMEGA|NEXA)_E_[A-Z0-9_]+$/.test(cause.code);
      reports.push({
        id: attack.id,
        category: attack.category,
        blocked: modelled,
        code: modelled ? cause.code : 'OMEGA_E_ADVERSARIAL_UNMODELLED',
        detail: { message: String(cause?.message ?? cause) },
      });
    }
  }
  return reports;
}

/**
 * The gate's own reading of the reports: counts, categories, and the verdict.
 *
 * @param {object[]} reports
 * @param {{min_attempts?: number, required_categories?: string[]}} [input]
 * @returns {{status: 'PASS'|'FAIL', detail: object}}
 */
export function summarizeAttacks(reports, { min_attempts = MIN_ATTACKS, required_categories = ATTACK_CATEGORIES } = {}) {
  if (!Array.isArray(reports)) {
    return { status: 'FAIL', detail: { reason: 'the adversarial stage reported no attack results' } };
  }
  const unblocked = reports.filter((report) => report.blocked !== true).map((report) => ({ id: report.id, category: report.category, code: report.code ?? null }));
  const categories = [...new Set(reports.map((report) => report.category))].sort();
  const missing = required_categories.filter((category) => !categories.includes(category));
  const detail = {
    attempts: reports.length,
    blocked: reports.length - unblocked.length,
    categories: categories.length,
    required_categories: required_categories.length,
    missing_categories: missing,
    unblocked,
  };
  if (reports.length < min_attempts) {
    return { status: 'FAIL', detail: { ...detail, reason: `only ${reports.length} attacks were attempted; ${min_attempts} are required` } };
  }
  if (missing.length > 0) {
    return { status: 'FAIL', detail: { ...detail, reason: `no attack was attempted in: ${missing.join(', ')}` } };
  }
  if (unblocked.length > 0) {
    return { status: 'FAIL', detail: { ...detail, reason: `${unblocked.length} attack(s) were not blocked: ${unblocked.map((attack) => attack.id).join(', ')}` } };
  }
  return { status: 'PASS', detail };
}

/** @param {object[]} reports @returns {string} a content address for a run */
export function adversarialDigest(reports) {
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_ADVERSARIAL_DOMAIN, 'utf8'),
    canonicalBytes(reports),
  ]));
}
