/**
 * The Ω security type system.
 *
 * Every value carries two attributes: `secrecy` (public < secret) and `trust`
 * (untrusted < internal < verified). Assignment, joins and sinks are checked against
 * those two attributes, so leaking a secret marked as secret, or laundering unverified
 * data into evidence, is not expressible — it is a compile error.
 */
import { OmegaError } from './errors.js';

export const SECRECY_RANK = Object.freeze({ public: 0, secret: 1 });
export const TRUST_RANK = Object.freeze({ untrusted: 0, internal: 1, verified: 2 });
export const SECRECY_LEVELS = Object.freeze(Object.keys(SECRECY_RANK));
export const TRUST_LEVELS = Object.freeze(['untrusted', 'internal', 'verified']);

const BASE_LABEL = Object.freeze({
  string: 'String',
  number: 'Number',
  bool: 'Bool',
  data: 'Data',
  cap: 'Capability',
});

/** Nominal types a module may name. Nothing else is declarable. */
export const TYPE_TABLE = Object.freeze({
  String: { base: 'string', secrecy: 'public', trust: 'internal' },
  Number: { base: 'number', secrecy: 'public', trust: 'internal' },
  Bool: { base: 'bool', secrecy: 'public', trust: 'internal' },
  SecretString: { base: 'string', secrecy: 'secret', trust: 'internal' },
  SecretNumber: { base: 'number', secrecy: 'secret', trust: 'internal' },
  SecretBool: { base: 'bool', secrecy: 'secret', trust: 'internal' },
  UntrustedData: { base: 'data', secrecy: 'public', trust: 'untrusted' },
  UntrustedString: { base: 'string', secrecy: 'public', trust: 'untrusted' },
  ToolResult: { base: 'data', secrecy: 'public', trust: 'untrusted' },
  UserIntent: { base: 'data', secrecy: 'public', trust: 'untrusted' },
  VerifiedData: { base: 'data', secrecy: 'public', trust: 'verified' },
  VerifiedString: { base: 'string', secrecy: 'public', trust: 'verified' },
  SignedEvidence: { base: 'data', secrecy: 'public', trust: 'verified' },
  MemoryRef: { base: 'data', secrecy: 'public', trust: 'internal' },
  Capability: { base: 'cap', secrecy: 'secret', trust: 'internal' },
});

/**
 * Attribute rows for values produced by instruments: an instrument declared
 * `trust verified` produces verified data; everything else is untrusted.
 * @param {{trust?: string, secret?: boolean, base?: string}} input
 * @returns {{base: string, secrecy: string, trust: string}}
 */
export function attrsFromInstrument({ trust = 'untrusted', secret = false, base = 'data' } = {}) {
  return { base, secrecy: secret ? 'secret' : 'public', trust };
}

/** @param {string} name @returns {{base: string, secrecy: string, trust: string}} */
export function typeAttrs(name) {
  const entry = TYPE_TABLE[name];
  if (entry === undefined) {
    throw new OmegaError('OMEGA_E_TYPE', `unknown type ${JSON.stringify(name)}`, { known: Object.keys(TYPE_TABLE).sort() });
  }
  return { ...entry };
}

/** @param {string} name @returns {boolean} */
export function isKnownType(name) {
  return Object.hasOwn(TYPE_TABLE, name);
}

/** Printable name for an attribute triple (nominal when it matches a table row). */
export function describeAttrs(attrs) {
  for (const [name, entry] of Object.entries(TYPE_TABLE)) {
    if (entry.base === attrs.base && entry.secrecy === attrs.secrecy && entry.trust === attrs.trust) return name;
  }
  const prefix = attrs.secrecy === 'secret' ? 'Secret' : '';
  const middle = attrs.trust === 'verified' ? 'Verified' : attrs.trust === 'untrusted' ? 'Untrusted' : '';
  return `${prefix}${middle}${BASE_LABEL[attrs.base] ?? 'Data'}`;
}

export const isSecret = (attrs) => attrs.secrecy === 'secret';
export const isVerified = (attrs) => attrs.trust === 'verified';

/**
 * `from ≤ to`: you may always be more secret and less trusting than the value you hold.
 * @param {{base: string, secrecy: string, trust: string}} from
 * @param {{base: string, secrecy: string, trust: string}} to
 * @returns {{ok: true} | {ok: false, axis: 'secrecy'|'trust'|'base', reason: string}}
 */
export function assignable(from, to) {
  if (SECRECY_RANK[from.secrecy] > SECRECY_RANK[to.secrecy]) {
    return {
      ok: false,
      axis: 'secrecy',
      reason: `a ${from.secrecy} value cannot flow into ${to.secrecy} territory (declassify it explicitly)`,
    };
  }
  if (TRUST_RANK[to.trust] > TRUST_RANK[from.trust]) {
    return {
      ok: false,
      axis: 'trust',
      reason: `a ${from.trust} value cannot be treated as ${to.trust} without verification`,
    };
  }
  if (from.base !== to.base && to.base !== 'data') {
    return { ok: false, axis: 'base', reason: `${from.base} is not ${to.base}` };
  }
  return { ok: true };
}

/**
 * Join of two values (operators, branches): maximally secret, minimally trusted.
 * @param {{base: string, secrecy: string, trust: string}} a
 * @param {{base: string, secrecy: string, trust: string}} b
 */
export function joinAttrs(a, b) {
  const secrecy = SECRECY_RANK[a.secrecy] >= SECRECY_RANK[b.secrecy] ? a.secrecy : b.secrecy;
  const trust = TRUST_RANK[a.trust] <= TRUST_RANK[b.trust] ? a.trust : b.trust;
  const base = a.base === b.base ? a.base : 'data';
  return { base, secrecy, trust };
}

/**
 * Sinks: every place a value leaves the program. A sink declares what it requires and
 * which code to raise when the requirement is not met.
 */
export const SINKS = Object.freeze({
  emit: { requirePublic: true, code: 'OMEGA_E_SECRET_EGRESS', what: 'the mission result' },
  tool_argument: { requirePublic: true, code: 'OMEGA_E_SECRET_EGRESS', what: 'a tool argument' },
  prompt: { requirePublic: true, code: 'OMEGA_E_SECRET_EGRESS', what: 'a model prompt' },
  remember: { requirePublic: true, code: 'OMEGA_E_SECRET_EGRESS', what: 'memory' },
  assertion: { requirePublic: true, code: 'OMEGA_E_SECRET_EGRESS', what: 'an assertion' },
  evidence: { requirePublic: true, requireVerified: true, code: 'OMEGA_E_EVIDENCE_UNTRUSTED', what: 'evidence' },
});

/**
 * @param {keyof typeof SINKS} sink
 * @param {{base: string, secrecy: string, trust: string}} attrs
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
export function checkSink(sink, attrs) {
  const rule = SINKS[sink];
  if (rule === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `unknown sink ${String(sink)}`);
  if (rule.requirePublic && attrs.secrecy !== 'public') {
    return {
      ok: false,
      code: rule.code,
      message: `a ${describeAttrs(attrs)} value cannot reach ${rule.what}: secrets stay in secrets`,
    };
  }
  if (rule.requireVerified && attrs.trust !== 'verified') {
    return {
      ok: false,
      code: rule.code,
      message: `${describeAttrs(attrs)} is not verified: only verified values become evidence`,
    };
  }
  return { ok: true };
}
