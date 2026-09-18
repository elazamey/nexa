/**
 * The evidence recorder — one writing path for every Google record kind.
 *
 * The five kinds this layer writes (`IDENTITY_VERIFIED`, `OWNER_BINDING`, `CONSENT`, `QUOTA`,
 * `APPROVAL`) all go through here, whether they land in a real Ω ledger or, when the host has no
 * ledger, in a journal that is still content-addressed and still shaped like the record it would
 * have been. That second part is not decoration: a journal record that is not ledger-shaped is
 * invisible to the learning layer, and evidence nobody can read is the same as evidence nobody
 * wrote.
 *
 * Without a ledger, a record is previewed before it is accepted: `preview()` refuses any kind
 * that the ledger would refuse, so a host cannot develop against a journal that would fail in
 * production.
 */
import { canonicalBytes } from '../../../../ast/index.js';
import { sha256Multihash } from '../../../../crypto/index.js';
import { OmegaError } from '../../../../compiler/index.js';
import { OMEGA_EVIDENCE_KINDS } from '../../../../runtime/index.js';

/** The kinds this layer is allowed to write. Registering them is the same commit's business. */
export const GOOGLE_EVIDENCE_KINDS = Object.freeze([
  'IDENTITY_VERIFIED',
  'OWNER_BINDING',
  'CONSENT',
  'QUOTA',
  'APPROVAL',
]);

const PASSTHROUGH = Object.freeze(['kind', 'decision', 'mission', 'step', 'subject', 'resource', 'action', 'capability', 'claim', 'trust', 'detail']);

/**
 * @param {{ledger?: object|null, actor: string, clock: () => Date, module?: string}} input
 */
export function createRecorder({ ledger = null, actor, clock, module = '<google>' }) {
  if (typeof actor !== 'string' || actor.length === 0) throw new OmegaError('OMEGA_E_IDENTITY', 'a recorder writes under an actor key');
  const journal = [];

  const shape = (fields) => {
    if (!OMEGA_EVIDENCE_KINDS.includes(fields.kind)) {
      throw new OmegaError('OMEGA_E_LEDGER', `unknown Ω record kind: ${String(fields.kind)}`);
    }
    if (!GOOGLE_EVIDENCE_KINDS.includes(fields.kind)) {
      throw new OmegaError('OMEGA_E_LEDGER', `${fields.kind} is not a kind the Google layer writes`);
    }
    return fields;
  };

  return {
    /** @param {object} fields @returns {{hash: string|null, seq: number}} */
    record(fields) {
      const accepted = shape(fields);
      if (ledger === null) {
        const seq = journal.length;
        const normalized = {
          seq,
          ts: clock().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          actor,
          module,
          mission: accepted.mission ?? '-',
          step: accepted.step ?? 0,
          ...accepted,
          detail: accepted.detail ?? {},
        };
        // The digest covers the record *without* its own hash. Passing `hash: undefined` here
        // would hand the canonicalizer a value it cannot spell, and a journal that cannot be
        // read is not evidence (NEXA_E_C14N_TYPE).
        const digest = sha256Multihash(canonicalBytes(normalized));
        journal.push({ ...normalized, hash: digest });
        return { hash: digest, seq };
      }
      const input = {};
      for (const key of PASSTHROUGH) {
        if (accepted[key] !== undefined) input[key] = accepted[key];
      }
      const sealed = ledger.append({ ...input, mission: accepted.mission ?? 'google.identity', step: accepted.step ?? ledger.length });
      journal.push({ ...accepted, seq: sealed.seq, hash: sealed.hash });
      return { hash: sealed.hash, seq: sealed.seq };
    },

    /** @returns {object[]} every record this layer wrote, in order */
    entries() {
      return journal.map((entry) => ({ ...entry }));
    },

    /** @returns {number} */
    get length() {
      return journal.length;
    },

    /** @returns {string|null} the ledger's chain head, when there is one */
    head() {
      if (ledger === null) return journal.length === 0 ? null : journal[journal.length - 1].hash;
      return ledger.head.hash;
    },
  };
}
