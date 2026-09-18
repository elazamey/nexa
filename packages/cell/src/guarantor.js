/**
 * The guarantor — the tissue's connection to the Authority.
 *
 * A cell may propose; it may not mint. This object is the only thing in the cellular
 * layer that can mint, and it is deliberately kept outside every cell: the tissue holds
 * it, passes each cell a `verify`/`record` port, and never passes the mint.
 *
 * Two rules make the topology honest:
 *
 *   · **routes are declared before traffic** — the grant set is sealed on the first issue,
 *     so a cell cannot widen the topology at run time by asking nicely;
 *   · **every token is single-use and presenter-bound** — the membrane verifies against
 *     the issuer allow-list, and a replayed token is refused (`NEXA_E_REPLAY`).
 */
import { canonicalBytes, formatInstant } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';
import { Authority } from '../../runtime/index.js';
import { verifyCapability } from '../../capability/index.js';

/** Cell capabilities are named `cell:<name>` with the receptor as the action. */
export const CELL_RESOURCE = (name) => `cell:${name}`;

/** @param {object} route @returns {string} the grant name for a route */
export const routeName = (route) => `${route.to}.${route.receptor}`;

/**
 * @param {object} input
 * @param {object} input.operator the identity that may mint
 * @param {() => Date} input.clock
 * @param {object} [input.ledger] an `OmegaLedger`; without one, evidence stays in memory
 * @param {{ttl_ms?: number, max_calls?: number}} [input.defaults]
 */
export function createGuarantor({ operator, clock, ledger = null, defaults = {} }) {
  const ttlMs = defaults.ttl_ms ?? 60_000;
  const maxCalls = defaults.max_calls ?? 100;
  const routes = new Map();
  const used = new Set();
  const journal = [];
  let authority = null;
  let sealed = false;

  const build = () => {
    const grants = [...routes.values()].map((route) => ({
      name: routeName(route),
      subject: route.from,
      resource: CELL_RESOURCE(route.to),
      actions: [route.receptor],
      ttl_ms: route.ttl_ms ?? ttlMs,
      max_calls: route.max_calls ?? maxCalls,
    }));
    authority = new Authority({ operator, grants, clock });
    return authority;
  };

  return {
    /** @param {object[]} declared @returns {number} how many routes are now known */
    declare(declared) {
      if (sealed) {
        throw new OmegaError('OMEGA_E_ROUTE', 'the topology is sealed: routes are declared before the first call');
      }
      for (const route of declared) {
        if (typeof route?.from !== 'string' || typeof route?.to !== 'string' || typeof route?.receptor !== 'string') {
          throw new OmegaError('OMEGA_E_ROUTE', 'a route is { from, to, receptor }');
        }
        routes.set(`${route.from}->${route.to}.${route.receptor}`, { ...route });
      }
      return routes.size;
    },

    /** @returns {object[]} the declared topology, as data */
    topology() {
      return [...routes.values()]
        .map((route) => ({ ...route }))
        .sort((a, b) => `${a.from}${a.to}${a.receptor}`.localeCompare(`${b.from}${b.to}${b.receptor}`));
    },

    /** @param {object} route @returns {boolean} */
    allows(route) {
      return routes.has(`${route.from}->${route.to}.${route.receptor}`);
    },

    /** @returns {object[]} per-grant usage, for a report */
    usage() {
      return authority === null ? [] : authority.usage();
    },

    /**
     * Mint one capability for one proposed call. The subject is the *sending cell's* key,
     * so a token minted for the planner cannot be presented by the coder.
     */
    issue({ from, fromKid, to, receptor, args = {} }) {
      sealed = true;
      if (authority === null) build();
      return authority.issue({ agent: from, agentKid: fromKid, resource: CELL_RESOURCE(to), action: receptor, args });
    },

    /**
     * @param {object} token
     * @param {{presenter: string, resource: string, action: string, at: Date}} input
     * @returns {object} the membrane's verdict
     */
    verify(token, { presenter, resource, action, at }) {
      if (token === null || typeof token !== 'object') {
        return { ok: false, code: 'OMEGA_E_CAP_MISSING', reason: 'a cell message must carry a capability', detail: {} };
      }
      if (used.has(token.id)) {
        // One call, one token: a token presented twice is a replay, whatever the reason.
        return { ok: false, code: 'NEXA_E_REPLAY', reason: `capability ${token.id} was already spent`, detail: { id: token.id } };
      }
      let verdict;
      try {
        verdict = verifyCapability(token, {
          presenter,
          now: at,
          uses: (id) => (used.has(id) ? 1 : 0),
          action,
          resource,
          // Fail closed: a guarantor with no named issuer accepts nothing.
          trustedIssuers: [operator.kid],
        });
      } catch (cause) {
        return { ok: false, code: cause.code ?? 'OMEGA_E_CAP_MISSING', reason: cause.message, detail: {} };
      }
      if (verdict.ok !== true) {
        return { ok: false, code: verdict.code ?? 'OMEGA_E_CAP_MISSING', reason: verdict.reason ?? 'the capability did not verify', detail: {} };
      }
      used.add(token.id);
      return { ok: true, grant: verdict.grant, code: null, reason: null };
    },

    /**
     * @param {object} entry a membrane decision
     * @returns {{hash: string|null}} the evidence record
     */
    record(entry) {
      if (ledger === null) {
        // No ledger: the journal is still content-addressed and still shaped like the record
        // it would have been — else the learning layer would see crossings it cannot read.
        const seq = journal.length;
        const normalized = {
          ...entry,
          seq,
          ts: formatInstant(clock()),
          mission: entry.cell,
          step: seq,
          resource: entry.cell,
          action: entry.receptor ?? null,
          module: '<cellular>',
        };
        const digest = sha256Multihash(canonicalBytes(normalized));
        journal.push({ ...normalized, hash: digest });
        return { hash: digest, seq };
      }
      const record = ledger.append({
        kind: 'CELL_MESSAGE',
        decision: entry.decision,
        mission: entry.cell,
        step: journal.length,
        resource: entry.cell,
        action: entry.receptor ?? null,
        ...(entry.capability === null || entry.capability === undefined ? {} : { capability: entry.capability }),
        detail: { from: entry.from ?? null, ...(entry.detail ?? {}) },
      });
      journal.push({ ...entry, seq: journal.length, hash: record.hash });
      return { hash: record.hash, seq: record.seq };
    },

    /** @returns {object[]} the evidence this guarantor produced, in order */
    entries() {
      return journal.map((entry) => ({ ...entry }));
    },
  };
}
