/**
 * Providers and secrets.
 *
 * `AIza…` is not a value Ω can express. A module declares a provider with a *handle*:
 *
 *     provider gemini { secret vault://gemini   strategy cheapest   fallback local   max_cost 0 }
 *
 * The vault resolves the handle in a different trust domain from the agent; the material
 * exists only inside `attach()`, which the registry calls and nothing else may. An
 * adapter that tries to hand the material back is refused by the runtime, and the
 * transcript never contains it — Ω records a digest of what was asked and what came
 * back, never a key.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

/** Adapters available by default. Deterministic: no network, no clock, no randomness. */
export const DEFAULT_ADAPTERS = Object.freeze({
  mock: {
    cost: 0,
    invoke: ({ payload }) => ({ provider: 'mock', text: `mock:${String(payload?.prompt ?? payload?.purpose ?? 'noop')}`, cost: 0 }),
  },
  local: {
    cost: 0,
    invoke: ({ payload }) => ({ provider: 'local', text: `local:${String(payload?.prompt ?? payload?.purpose ?? 'noop')}`, cost: 0 }),
  },
  huggingface: {
    cost: 1,
    invoke: ({ payload }) => ({ provider: 'huggingface', text: `hf:${String(payload?.prompt ?? payload?.purpose ?? 'noop')}`, cost: 1 }),
  },
  openrouter: {
    cost: 3,
    invoke: ({ payload }) => ({ provider: 'openrouter', text: `or:${String(payload?.prompt ?? payload?.purpose ?? 'noop')}`, cost: 3 }),
  },
  gemini: {
    cost: 5,
    accepts_secret: true,
    invoke: ({ payload, secret }) => ({
      provider: 'gemini',
      text: `gemini:${String(payload?.prompt ?? payload?.purpose ?? 'noop')}`,
      cost: 5,
      authenticated: secret !== undefined && secret !== null,
    }),
  },
});

const VAULT_PREFIX = 'vault://';

export class Vault {
  #material;

  /** @param {{secrets?: Record<string, string>}} [input] handles (`gemini`) → material */
  constructor({ secrets = {} } = {}) {
    this.#material = new Map();
    for (const [name, value] of Object.entries(secrets)) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new OmegaError('OMEGA_E_SECRET_UNAVAILABLE', `vault entry ${name} must be a non-empty string`);
      }
      this.#material.set(name, value);
    }
  }

  /** @param {string} handle e.g. `vault://gemini` @returns {string} */
  static nameOf(handle) {
    if (typeof handle !== 'string' || !handle.startsWith(VAULT_PREFIX)) {
      throw new OmegaError('OMEGA_E_SECRET_LITERAL', `a secret handle looks like \`${VAULT_PREFIX}name\`, found ${String(handle)}`);
    }
    const name = handle.slice(VAULT_PREFIX.length);
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
      throw new OmegaError('OMEGA_E_SECRET_LITERAL', `invalid secret handle: ${handle}`);
    }
    return name;
  }

  /** @param {string} name @returns {boolean} */
  has(name) {
    return this.#material.has(name);
  }

  /** @returns {string[]} handles, never material */
  handles() {
    return [...this.#material.keys()].sort().map((name) => `${VAULT_PREFIX}${name}`);
  }

  /**
   * What a program may see: an availability answer and a digest. Never the material.
   * @param {string} handle
   */
  resolve(handle) {
    const name = Vault.nameOf(handle);
    const present = this.#material.has(name);
    return {
      handle,
      redacted: true,
      available: present,
      ...(present ? { digest: sha256Multihash(Buffer.from(this.#material.get(name), 'utf8')) } : {}),
    };
  }

  /**
   * Runtime-internal: the only path to the material. Called by `ProviderRegistry` to
   * attach a credential to an outbound adapter call, and nowhere else.
   * @param {string} handle
   * @returns {string|undefined}
   */
  attach(handle) {
    return this.#material.get(Vault.nameOf(handle));
  }
}

export class ProviderRegistry {
  #adapters;

  /**
   * @param {object} input
   * @param {object[]} input.providers compiled provider declarations (`ir.providers`)
   * @param {Vault} [input.vault]
   * @param {Record<string, object>} [input.adapters]
   */
  constructor({ providers = [], vault = new Vault(), adapters = {} } = {}) {
    this.providers = providers.map((provider) => ({ ...provider, fallback: [...(provider.fallback ?? [])] }));
    this.vault = vault;
    this.#adapters = { ...DEFAULT_ADAPTERS, ...adapters };
    for (const [name, adapter] of Object.entries(this.#adapters)) {
      if (typeof adapter?.invoke !== 'function' || !Number.isSafeInteger(adapter.cost ?? 0)) {
        throw new OmegaError('OMEGA_E_SCHEMA', `adapter ${name} must be { cost: integer, invoke() }`);
      }
    }
    this.calls = [];
  }

  /** @param {string} name @returns {object} */
  adapter(name) {
    const adapter = this.#adapters[name];
    if (adapter === undefined) {
      throw new OmegaError('OMEGA_E_PROVIDER_UNAVAILABLE', `no adapter named ${name}`, { known: Object.keys(this.#adapters).sort() });
    }
    return adapter;
  }

  /** @param {string} name @returns {object|null} */
  declared(name) {
    return this.providers.find((provider) => provider.name === name) ?? null;
  }

  /**
   * Deterministic provider selection. `declared` honours the named adapter (a module
   * that names a provider means that provider); `cheapest`/`free` search the named
   * adapter, then the declared fallbacks, then everything available, by cost asc.
   * @param {{name?: string, strategy?: string|null, max_cost?: number|null, fallback?: string[]}} input
   * @returns {{name: string, cost: number, strategy: string, declared: object|null}}
   */
  select({ name = 'auto', strategy = null, max_cost = null, fallback = [] } = {}) {
    const effectiveStrategy = strategy ?? (name === 'auto' ? 'cheapest' : 'declared');
    const ceiling = max_cost ?? null;
    const candidates = [];
    if (name !== 'auto') candidates.push(name);
    candidates.push(...fallback);
    candidates.push(...Object.keys(this.#adapters).sort());
    const affordable = [];
    for (const candidate of candidates) {
      const adapter = this.#adapters[candidate];
      if (adapter === undefined) continue;
      if (affordable.some((entry) => entry.name === candidate)) continue;
      if (effectiveStrategy === 'free' && adapter.cost !== 0) continue;
      if (ceiling !== null && adapter.cost > ceiling) continue;
      affordable.push({ name: candidate, cost: adapter.cost, strategy: effectiveStrategy, declared: this.declared(candidate) });
    }
    if (affordable.length === 0) {
      throw new OmegaError('OMEGA_E_PROVIDER_UNAVAILABLE', `no provider satisfies strategy=${effectiveStrategy} max_cost=${String(ceiling)}`, {
        available: Object.keys(this.#adapters).sort(),
      });
    }
    if (effectiveStrategy === 'declared' && name !== 'auto') return affordable[0];
    affordable.sort((a, b) => (a.cost - b.cost) || a.name.localeCompare(b.name));
    return affordable[0];
  }

  /**
   * Invokes a provider through its adapter. The secret never appears in the result.
   * A `handle` (from `secrets.load`) is resolved here, in the runtime's trust domain:
   * the program passes a handle, never material.
   * @param {{provider: string, payload?: object, handle?: {handle: string}|null}} input
   * @returns {{provider: string, text: string, cost: number, secret_used: boolean, payload_digest: string}}
   */
  invoke({ provider, payload = {}, handle = null }) {
    const declared = this.declared(provider);
    const strategy = declared?.strategy ?? (provider === 'auto' ? 'cheapest' : 'declared');
    const selection = this.select({
      name: provider,
      strategy,
      max_cost: declared?.max_cost ?? null,
      fallback: declared?.fallback ?? [],
    });
    const adapter = this.adapter(selection.name);
    const requestedHandle = typeof handle === 'object' && handle !== null ? handle.handle : null;
    const effectiveHandle = requestedHandle ?? declared?.secret ?? null;
    if (effectiveHandle !== null && adapter.accepts_secret !== true) {
      throw new OmegaError('OMEGA_E_SECRET_EGRESS', `adapter ${selection.name} does not accept a credential`);
    }
    let material;
    if (effectiveHandle !== null) {
      const resolved = this.vault.resolve(effectiveHandle);
      if (!resolved.available) {
        throw new OmegaError('OMEGA_E_SECRET_UNAVAILABLE', `the vault does not hold ${effectiveHandle}`, { handle: effectiveHandle });
      }
      material = this.vault.attach(effectiveHandle);
    }
    canonicalBytes(payload);
    const result = adapter.invoke({ payload, secret: material });
    const text = typeof result?.text === 'string' ? result.text : canonicalBytes(result ?? {}).toString('utf8');
    if (material !== undefined && (text.includes(material) || JSON.stringify(result ?? {}).includes(material))) {
      // An adapter that echoes its credential is a leak; the call fails rather than
      // letting the secret reach a transcript, a receipt or a mission result.
      throw new OmegaError('OMEGA_E_SECRET_EGRESS', `adapter ${selection.name} tried to return secret material`);
    }
    const call = {
      provider: selection.name,
      declared: declared?.name ?? null,
      handle: effectiveHandle,
      cost: adapter.cost,
      secret_used: material !== undefined,
      payload_digest: sha256Multihash(canonicalBytes(payload)),
    };
    this.calls.push(call);
    return { ...call, text };
  }

  /** @returns {object} posture for a report */
  describe() {
    return {
      vault: { handles: this.vault.handles(), redacted: true },
      adapters: Object.entries(this.#adapters)
        .map(([name, adapter]) => ({ name, cost: adapter.cost }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      declared: this.providers.map((provider) => ({
        name: provider.name,
        secret: provider.secret,
        strategy: provider.strategy,
        fallback: provider.fallback,
        max_cost: provider.max_cost,
      })),
      calls: this.calls.length,
    };
  }
}
