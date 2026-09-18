/**
 * Version manifests — proof-carrying versions.
 *
 * A manifest is what a version *is*: the hash of the source, the hash of the IR that
 * would execute, the capability surface it needs, the checks it has passed, its parent,
 * and a signature by the identity that proposed it. The loader accepts a manifest only
 * if every field verifies: `VALID → LOAD`, `INVALID → REJECT`, with no partial load and
 * no "trust me" path.
 */
import { canonicalBytes, formatInstant, parseInstant } from '../../ast/index.js';
import { sha256Multihash, verifyBytes, publicKeyFromKeyId } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_MANIFEST_DOMAIN = 'NEXA/omega1 evolution manifest\u0000';
export const OMEGA_SOURCE_DOMAIN = 'NEXA/omega1 module source\u0000';

/**
 * Modules no proposal may ever target. The kernel, the verifier, the policy engine and
 * the capability authority are not evolvable — by anyone, under any manifest. This list
 * is checked before any gate stage runs.
 */
export const KERNEL_MODULES = Object.freeze([
  'kernel',
  'verifier',
  'policy-engine',
  'capability-authority',
  'omega-kernel',
  'evidence-ledger',
]);

const MANIFEST_FIELDS = Object.freeze([
  'nexa', 'module', 'version', 'parent', 'source_hash', 'ir_hash', 'capabilities',
  'expectations', 'checks', 'evolver', 'created', 'signature',
]);

const REQUIRED_FIELDS = Object.freeze([
  'nexa', 'module', 'version', 'parent', 'source_hash', 'ir_hash', 'capabilities',
  'expectations', 'checks', 'evolver', 'created', 'signature',
]);

/** @param {object} manifest @returns {Buffer} */
export function manifestPayload(manifest) {
  const { signature, ...unsigned } = manifest; // eslint-disable-line no-unused-vars
  return Buffer.concat([Buffer.from(OMEGA_MANIFEST_DOMAIN, 'utf8'), canonicalBytes(unsigned)]);
}

/** @param {object} manifest @returns {string} */
export function manifestHash(manifest) {
  return sha256Multihash(manifestPayload(manifest));
}

/** @param {string} source @returns {string} */
export function sourceHash(source) {
  return sha256Multihash(Buffer.concat([Buffer.from(OMEGA_SOURCE_DOMAIN, 'utf8'), Buffer.from(source, 'utf8')]));
}

/**
 * The capability surface of a compiled module, as stable names.
 * @param {object} ir compiled Ω IR
 * @returns {string[]} e.g. `["sanitizer:*!redact", "tool:echo!call"]`
 */
export function capabilitiesOf(ir) {
  const names = new Set();
  for (const agent of ir.agents ?? []) {
    for (const entry of agent.allow ?? []) {
      for (const action of entry.actions ?? []) names.add(`${entry.resource}!${action}`);
    }
  }
  return [...names].sort();
}

/** @param {string} ref e.g. `planner@5` @returns {{module: string, version: number}} */
export function parseRef(ref) {
  if (typeof ref !== 'string') throw new OmegaError('OMEGA_E_MANIFEST', `a version reference is a string like "planner@5"`);
  const match = ref.match(/^([a-z][a-z0-9_-]{0,63})@([0-9]+)$/);
  if (match === null) throw new OmegaError('OMEGA_E_MANIFEST', `malformed version reference: ${ref}`);
  return { module: match[1], version: Number.parseInt(match[2], 10) };
}

/** @param {string} module @param {number} version @returns {string} */
export function refOf(module, version) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(module)) throw new OmegaError('OMEGA_E_MANIFEST', `invalid module name: ${String(module)}`);
  if (!Number.isSafeInteger(version) || version < 1) throw new OmegaError('OMEGA_E_MANIFEST', `invalid version: ${String(version)}`);
  return `${module}@${version}`;
}

/**
 * @param {object} input
 * @param {string} input.module
 * @param {number} input.version
 * @param {number|null} [input.parent]
 * @param {string} [input.source] module source text
 * @param {{hash: string, ir: object}|null} [input.compiled] a successful `compile()`
 * @param {string[]} [input.capabilities]
 * @param {{metric: string, op: string, value: number}[]} [input.expectations]
 * @param {object} [input.checks]
 * @param {{kid: string}} input.evolver
 * @param {Date} [input.created]
 * @param {boolean} [input.allowKernelTarget] test-only escape hatch, refused by default
 * @returns {object} an unsigned manifest
 */
export function createManifest({
  module,
  version,
  parent = null,
  source = null,
  compiled = null,
  capabilities = null,
  expectations = [],
  checks = {},
  evolver,
  created = new Date('1970-01-01T00:00:00Z'),
  allowKernelTarget = false,
}) {
  if (KERNEL_MODULES.includes(module) && !allowKernelTarget) {
    throw new OmegaError('OMEGA_E_KERNEL_IMMUTABLE', `${module} is not evolvable: the kernel is immutable by construction`, {
      module,
      kernel_modules: [...KERNEL_MODULES],
    });
  }
  if (evolver?.kid === undefined) throw new OmegaError('OMEGA_E_MANIFEST', 'a manifest needs the evolver identity');
  const ir = compiled?.ir ?? null;
  if ((source === null || compiled === null) && parent === null) {
    throw new OmegaError('OMEGA_E_MANIFEST', 'a manifest needs a source and its compiled IR (or a parent to inherit from)');
  }
  return {
    nexa: 'omega1',
    module,
    version,
    parent,
    source_hash: source === null ? null : sourceHash(source),
    ir_hash: compiled?.hash ?? null,
    capabilities: (capabilities ?? (ir === null ? [] : capabilitiesOf(ir))).slice().sort(),
    expectations: expectations.map((expectation) => ({ metric: expectation.metric, op: expectation.op, value: expectation.value })),
    checks: Object.fromEntries(Object.entries(checks).sort(([a], [b]) => a.localeCompare(b))),
    evolver: evolver.kid,
    created: formatInstant(created),
    signature: null,
  };
}

/**
 * @param {object} manifest unsigned manifest
 * @param {{keys: object, kid: string}} evolver
 * @returns {object} the signed manifest
 */
export function signManifest(manifest, evolver) {
  if (evolver?.keys === undefined) throw new OmegaError('OMEGA_E_SIGNATURE', 'signing a manifest needs a key pair');
  if (evolver.kid !== manifest.evolver) {
    throw new OmegaError('OMEGA_E_SIGNATURE', 'the manifest names a different evolver than the signing key');
  }
  const unsigned = { ...manifest, signature: null };
  return {
    ...unsigned,
    signature: {
      kind: 'ed25519',
      alg: 'ed25519',
      kid: evolver.kid,
      val: evolver.keys.sign(manifestPayload(unsigned)),
    },
  };
}

/**
 * @param {object} manifest
 * @param {{evolvers?: string[]|null}} [options] who may propose (null = anyone who signs)
 * @returns {{ok: true, ref: string, hash: string} | {ok: false, code: string, reason: string}}
 */
export function verifyManifest(manifest, { evolvers = null } = {}) {
  try {
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new OmegaError('OMEGA_E_MANIFEST', 'a manifest must be an object');
    }
    for (const key of Object.keys(manifest)) {
      if (!MANIFEST_FIELDS.includes(key)) throw new OmegaError('OMEGA_E_MANIFEST', `unknown manifest field: ${key}`);
    }
    for (const key of REQUIRED_FIELDS) {
      if (!Object.hasOwn(manifest, key)) throw new OmegaError('OMEGA_E_MANIFEST', `missing manifest field: ${key}`);
    }
    if (manifest.nexa !== 'omega1') throw new OmegaError('OMEGA_E_MANIFEST', `unsupported manifest version: ${String(manifest.nexa)}`);
    const ref = refOf(manifest.module, manifest.version);
    if (KERNEL_MODULES.includes(manifest.module)) {
      throw new OmegaError('OMEGA_E_KERNEL_IMMUTABLE', `${manifest.module} is not evolvable: the kernel is immutable by construction`);
    }
    parseInstant(manifest.created);
    if (manifest.parent !== null && (!Number.isSafeInteger(manifest.parent) || manifest.parent < 1)) {
      throw new OmegaError('OMEGA_E_MANIFEST', 'parent must be null or a positive version number');
    }
    if (!Number.isSafeInteger(manifest.version) || manifest.version < 1) {
      throw new OmegaError('OMEGA_E_MANIFEST', 'version must be a positive integer');
    }
    for (const capability of manifest.capabilities) {
      if (typeof capability !== 'string' || !/^[a-z][a-z0-9_-]{0,31}:[^\s!]*![a-z][a-z0-9_-]{0,31}$/.test(capability)) {
        throw new OmegaError('OMEGA_E_MANIFEST', `malformed capability name: ${String(capability)}`);
      }
    }
    for (const expectation of manifest.expectations) {
      if (typeof expectation?.metric !== 'string' || typeof expectation?.op !== 'string' || !Number.isSafeInteger(expectation?.value)) {
        throw new OmegaError('OMEGA_E_MANIFEST', 'an expectation is { metric: string, op: string, value: integer }');
      }
      if (!['==', '!=', '<', '<=', '>', '>='].includes(expectation.op)) {
        throw new OmegaError('OMEGA_E_MANIFEST', `unknown comparison in expectation: ${expectation.op}`);
      }
    }
    if (manifest.signature === null || typeof manifest.signature !== 'object') {
      throw new OmegaError('OMEGA_E_SIGNATURE', 'an unsigned manifest is not a manifest');
    }
    if (manifest.signature.kid !== manifest.evolver) {
      throw new OmegaError('OMEGA_E_SIGNATURE', 'the manifest signature must be by its declared evolver');
    }
    const ok = verifyBytes(publicKeyFromKeyId(manifest.signature.kid), manifestPayload(manifest), manifest.signature.val);
    if (!ok) throw new OmegaError('OMEGA_E_SIGNATURE', `the manifest for ${ref} does not verify`);
    if (evolvers !== null && !evolvers.includes(manifest.evolver)) {
      throw new OmegaError('OMEGA_E_NOT_ACTIVATOR', `${manifest.evolver} is not an allowed evolver`, { allowed: [...evolvers].sort() });
    }
    return { ok: true, ref, hash: manifestHash(manifest) };
  } catch (cause) {
    if (cause instanceof OmegaError) return { ok: false, code: cause.code, reason: cause.message };
    return { ok: false, code: 'OMEGA_E_MANIFEST', reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
