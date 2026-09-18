/**
 * The token vault — where Google material lives, and the shape it has when it leaves.
 *
 * A cell never sees a token. It sees a **handle**: a frozen descriptor that names the service,
 * the subject (a `sub_hash`, never the raw subject), the scopes and the expiry. The material
 * itself is only reachable through `resolve()`, whose caller is the adapter, and only when the
 * presenter is the key the handle was issued to:
 *
 *     handle.presenter !== presenter  ⇒  NEXA_E_CAP_AUDIENCE
 *
 * That is the whole confused-deputy defence: a handle that leaks into another cell is inert,
 * because being *held* is not being *entitled*.
 *
 * Refresh happens here and nowhere else, five minutes before expiry, with a single flight per
 * subject: a second attempt while one is in flight is refused rather than doubled, and a failed
 * refresh destroys the material and reports `OMEGA_E_TOKEN` — the cell is left needing a new
 * consent rather than running on a credential nobody could refresh. A refresh that fails
 * because the provider ended the authorization on its own schedule is the *expected*
 * reauthorization condition, and the caller turns it into a `CONSENT` record, not an incident.
 */
import { NexaError } from '../../../../ast/index.js';
import { OmegaError } from '../../../../compiler/index.js';

const REFRESH_MARGIN_MS = 300_000;

/** @param {string} value @returns {boolean} a handle never carries material */
function looksLikeMaterial(value) {
  return typeof value === 'string' && /^(ya29\.|AIza[0-9A-Za-z_-]{10,}|1\/\/|eyJ[A-Za-z0-9_-]{8,}\.)/.test(value);
}

/**
 * @param {{clock: () => Date, refresh?: ((input: object) => object)|null, record?: Function|null,
 *          secrets?: Record<string, object>}} input
 *   `refresh` is the injected token-endpoint port. With none, an expired handle is refused —
 *   fail-closed, which is what a vault without a way to renew should do.
 */
export function createTokenVault({ clock, refresh = null, record = null, secrets = {} }) {
  /** @type {Map<string, object>} keyed by `${sub_hash}|${service}` — material, never a subject */
  const entries = new Map();
  const inFlight = new Set();
  const journal = [];

  const keyOf = (subHash, service) => `${subHash}|${service}`;

  const note = (step, detail = {}) => {
    journal.push({ step, at: clock().toISOString().replace(/\.\d{3}Z$/, 'Z'), ...detail });
  };

  const store = ({ sub_hash, service, access_token, refresh_token = null, scopes = [], expires_at }) => {
    if (typeof sub_hash !== 'string' || sub_hash.length === 0) throw new OmegaError('OMEGA_E_TOKEN', 'vault material is keyed by sub_hash');
    if (typeof access_token !== 'string' || access_token.length === 0) throw new OmegaError('OMEGA_E_TOKEN', 'a vault entry needs material to hold');
    entries.set(keyOf(sub_hash, service), { access_token, refresh_token, scopes: [...scopes], expires_at });
    note('put', { service, scopes: [...scopes], expires_at });
  };

  for (const [key, material] of Object.entries(secrets)) {
    const [subHash, service] = key.split('|');
    store({ sub_hash: subHash, service, ...material });
  }

  const renew = (entryKey, subHash, service) => {
    if (inFlight.has(entryKey)) {
      throw new OmegaError('OMEGA_E_TOKEN', `a refresh for ${service} is already in flight; a second one would double the credential`, { service });
    }
    if (refresh === null) {
      throw new OmegaError('OMEGA_E_TOKEN', `the material for ${service} expired and no refresh port is wired`, { service });
    }
    inFlight.add(entryKey);
    note('refresh.begin', { service });
    try {
      const renewed = refresh({ service, sub_hash: subHash, refresh_token: entries.get(entryKey)?.refresh_token ?? null });
      if (renewed === null || typeof renewed?.access_token !== 'string') {
        throw new OmegaError('OMEGA_E_TOKEN', `the ${service} refresh returned no material`, { service });
      }
      // Re-vaulting replaces the entry: the old material is destroyed, not kept alongside.
      store({ sub_hash: subHash, service, ...renewed });
      note('refresh.done', { service, expires_at: renewed.expires_at ?? null });
      return entries.get(entryKey);
    } catch (cause) {
      // A refresh that failed leaves nothing behind to try again with.
      entries.delete(entryKey);
      note('refresh.failed', { service, code: cause.code ?? 'OMEGA_E_TOKEN' });
      if (record !== null) {
        record({ kind: 'CONSENT', decision: 'DENY', resource: `vault://google/${service}`, action: 'refresh', detail: { service, code: cause.code ?? 'OMEGA_E_TOKEN', expected: 'reauthorization' } });
      }
      throw cause instanceof OmegaError ? cause : new OmegaError('OMEGA_E_TOKEN', cause.message);
    } finally {
      inFlight.delete(entryKey);
    }
  };

  const materialFor = (handle, presenter) => {
    if (typeof handle !== 'object' || handle === null || typeof handle.handle !== 'string') {
      throw new OmegaError('OMEGA_E_TOKEN', 'a resolve takes a handle');
    }
    if (handle.presenter !== presenter) {
      // The same question attenuation asks of a capability, so the same code answers it: a vault
      // handle, like a capability, is addressed to one holder and is worthless to another.
      throw new NexaError('NEXA_E_CAP_AUDIENCE', `handle ${handle.handle} was issued to another cell (${String(handle.presenter)})`);
    }
    const entryKey = keyOf(handle.subject, handle.service);
    const entry = entries.get(entryKey);
    if (entry === undefined) {
      throw new OmegaError('OMEGA_E_TOKEN', `no material for ${handle.service}`, { service: handle.service });
    }
    if (Date.parse(entry.expires_at) - clock().getTime() <= REFRESH_MARGIN_MS) {
      return renew(entryKey, handle.subject, handle.service);
    }
    note('resolve', { service: handle.service, presenter });
    return entry;
  };

  return {
    /**
     * @param {{sub_hash: string, service: string, presenter: string, scopes?: string[],
     *          expires_at: string}} input
     * @returns {Readonly<object>} the handle — a descriptor with no material in it
     */
    handleFor({ sub_hash, service, presenter, scopes = [], expires_at }) {
      const entry = entries.get(keyOf(sub_hash, service));
      if (entry === undefined) throw new OmegaError('OMEGA_E_TOKEN', `no material for ${service}, so there is no handle to issue`, { service });
      const handle = Object.freeze({
        handle: `vault://google/${service}`,
        service,
        presenter,
        subject: sub_hash,
        scopes: Object.freeze([...scopes]),
        expires_at: expires_at ?? entry.expires_at,
      });
      for (const value of Object.values(handle)) {
        if (looksLikeMaterial(value)) throw new OmegaError('OMEGA_E_SECRET_EGRESS', 'a handle would carry material');
      }
      note('handle', { service, presenter });
      return handle;
    },

    /**
     * The one path to material, for the adapter. Presenter-bound, refresh-aware.
     * @param {{handle: object, presenter: string}} input
     * @returns {{access_token: string, refresh_token: string|null, scopes: string[], expires_at: string}}
     */
    resolve({ handle, presenter }) {
      const entry = materialFor(handle, presenter);
      return { access_token: entry.access_token, refresh_token: entry.refresh_token, scopes: [...entry.scopes], expires_at: entry.expires_at };
    },

    /** What a caller may see without being the holder: availability and a digest. */
    inspect({ handle, presenter }) {
      const entry = entries.get(keyOf(handle.subject, handle.service));
      return {
        handle: handle.handle,
        service: handle.service,
        holder: handle.presenter === presenter,
        available: entry !== undefined,
        expired: entry === undefined ? true : Date.parse(entry.expires_at) <= clock().getTime(),
      };
    },

    /**
     * Delete every entry for a subject. This runs **before** a revocation, always: a token that
     * survives a revocation is a defect, not a delay.
     * @param {string} subHash @returns {number} how many entries were destroyed
     */
    deleteFor(subHash) {
      let deleted = 0;
      for (const key of [...entries.keys()]) {
        if (key.startsWith(`${subHash}|`)) {
          entries.delete(key);
          deleted += 1;
        }
      }
      note('delete', { subject: subHash, deleted });
      return deleted;
    },

    /** @returns {number} */
    get size() {
      return entries.size;
    },

    /** @returns {object[]} the vault's own audit trail: steps and services, never material */
    journal() {
      return journal.map((entry) => ({ ...entry }));
    },
  };
}
