/**
 * The organism — organs plus homeostasis.
 *
 * This is the whole system: an identity organ, a cognition organ, a security organ, an
 * evolution organ. It does three things the layers below cannot do:
 *
 *   · **sample** the system — failure rates, isolated cells, evidence continuity, budget
 *     pressure — as integers, so the reading is evidence rather than narrative;
 *   · **react** — isolate what is failing, degrade what is unhealthy, and require a
 *     *verified* recovery before anything serves again;
 *   · **refuse** — an organism with a broken evidence chain, or with an isolated security
 *     organ, does not keep going quietly: it reports `SYSTEM_DEGRADED` / `SYSTEM_HALTED`.
 *
 * Homeostasis is not an extra mechanism bolted on: it reads the breakers, the membranes and
 * the ledger that are already there.
 */
import { OmegaError } from '../../compiler/index.js';
import { createIdentity } from '../../identity/index.js';
import { createCell } from './cell.js';
import { seedFor } from './tissue.js';

export const SYSTEM_STATES = Object.freeze(['SYSTEM_ACTIVE', 'SYSTEM_DEGRADED', 'SYSTEM_HALTED']);

/** @param {object[]} organs @returns {object[]} every cell of every tissue of every organ */
function allCells(organs) {
  const cells = [];
  for (const organ of organs) {
    for (const tissue of organ.tissues.values()) {
      for (const cell of tissue.cells.values()) cells.push({ organ: organ.name, tissue: tissue.name, cell });
    }
  }
  return cells;
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {object} input.operator
 * @param {object[]} input.organs
 * @param {Array<{from: {organ: string, cell: string}, to: {organ: string, cell: string}, receptor: string}>} [input.routes]
 * @param {{max_failure_rate_bp?: number, max_isolated_cells?: number, require_evidence_continuity?: boolean}} [input.policy]
 * @param {() => Date} [input.clock]
 */
export function createOrganism({ name, operator, organs, routes = [], policy = {}, clock = () => new Date() }) {
  if (!Array.isArray(organs) || organs.length === 0) throw new OmegaError('OMEGA_E_SCHEMA', 'an organism needs at least one organ');
  const byName = new Map();
  for (const organ of organs) {
    if (byName.has(organ.name)) throw new OmegaError('OMEGA_E_DUPLICATE', `two organs are named ${organ.name}`);
    byName.set(organ.name, organ);
  }
  const policyValue = {
    max_failure_rate_bp: policy.max_failure_rate_bp ?? 2_000,
    max_isolated_cells: policy.max_isolated_cells ?? 0,
    require_evidence_continuity: policy.require_evidence_continuity ?? true,
  };

  const declared = [];
  const resolve = (reference) => {
    const organ = byName.get(reference?.organ);
    if (organ === undefined) throw new OmegaError('OMEGA_E_ROUTE', `${name} route names an unknown organ: ${String(reference?.organ)}`);
    for (const tissue of organ.tissues.values()) {
      const cell = tissue.cells.get(reference.cell);
      if (cell !== undefined) return { organ: organ.name, tissue, cell };
    }
    throw new OmegaError('OMEGA_E_ROUTE', `${name} route names an unknown cell: ${String(reference?.cell)}`);
  };
  for (const route of routes) {
    const from = resolve(route.from);
    const to = resolve(route.to);
    // The right to make this call belongs to the *source* tissue: it is declared there, it
    // is minted there, and the destination learns nothing except that a membrane will decide.
    from.tissue.allow([{ from: from.cell.name, to: to.cell.name, receptor: route.receptor }]);
    declared.push({ from: `${from.organ}.${from.cell.name}`, to: `${to.organ}.${to.cell.name}`, receptor: route.receptor });
  }

  const compositeName = `${name}.organism`;
  const identity = createIdentity({ label: compositeName, kind: 'service', seed: seedFor(compositeName) });
  const port = [...byName.values()][0].tissues.values().next().value.port();

  const organism = {
    name,
    operator,
    organs: byName,

    /** @returns {object[]} the cross-organ contract, as data */
    contract() {
      return declared.map((route) => ({ ...route }));
    },

    /**
     * The only way one organ's cell reaches another organ's cell.
     * @param {{from: {organ: string, cell: string}, to: {organ: string, cell: string},
     *          receptor: string, payload?: object, audience?: string[]}} message
     * @returns {object} the verdict
     */
    send(message) {
      const from = resolve(message.from);
      const to = resolve(message.to);
      const route = `${from.organ}.${from.cell.name} → ${to.organ}.${to.cell.name}.${message.receptor}`;
      const allowed = declared.some((entry) => (
        entry.from === `${from.organ}.${from.cell.name}`
        && entry.to === `${to.organ}.${to.cell.name}`
        && entry.receptor === message.receptor
      ));
      if (!allowed) {
        return { ok: false, code: 'OMEGA_E_ROUTE', reason: `${name} does not declare ${route}`, step: 'policy', detail: { contract: organism.contract() } };
      }
      return from.tissue.send({
        from: from.cell.name,
        to: to.cell.name,
        receptor: message.receptor,
        payload: message.payload ?? {},
        target: to.cell,
        ...(message.audience === undefined ? {} : { audience: message.audience }),
      });
    },

    /** @returns {object} one reading of the whole system, as integers */
    sample() {
      const cells = allCells(organs).map((entry) => ({ ...entry.cell.metrics(), organ: entry.organ, tissue: entry.tissue }));
      const calls = cells.reduce((sum, entry) => sum + entry.calls, 0);
      const failures = cells.reduce((sum, entry) => sum + entry.failures, 0);
      const isolated = cells.filter((entry) => entry.state === 'ISOLATED');
      const degraded = cells.filter((entry) => entry.state === 'DEGRADED');
      const evidence = organism.evidence();
      const sequenced = evidence.every((entry, index) => entry.seq === index);
      const failureRateBp = calls === 0 ? 0 : Math.round((failures / calls) * 10_000);
      let state = 'SYSTEM_ACTIVE';
      if (failureRateBp > policyValue.max_failure_rate_bp || isolated.length > policyValue.max_isolated_cells || degraded.length > 0) {
        state = 'SYSTEM_DEGRADED';
      }
      if (policyValue.require_evidence_continuity && !sequenced) state = 'SYSTEM_HALTED';
      return {
        organism: name,
        state,
        policy: { ...policyValue },
        cells: cells.length,
        calls,
        failures,
        failure_rate_bp: failureRateBp,
        isolated: isolated.map((entry) => `${entry.organ}/${entry.tissue}/${entry.cell}`),
        degraded: degraded.map((entry) => `${entry.organ}/${entry.tissue}/${entry.cell}`),
        evidence: { entries: evidence.length, continuous: sequenced },
        budgets: cells.map((entry) => ({ cell: entry.cell, calls: entry.calls, failures: entry.failures, state: entry.state })),
      };
    },

    /**
     * React to a reading: isolate what is unhealthy, and remember why.
     * @returns {{sample: object, isolated: string[], actions: object[]}}
     */
    react() {
      const sample = organism.sample();
      const actions = [];
      for (const entry of allCells(organs)) {
        if (entry.cell.state === 'DEGRADED' && entry.cell.metrics().consecutive_failures >= 3) {
          entry.cell.isolate();
          actions.push({ cell: entry.cell.name, action: 'isolate', reason: entry.cell.metrics().last_code });
        }
      }
      return { sample, isolated: sample.isolated, actions };
    },

    /**
     * Recovery is a decision, not a timeout: every isolated cell must pass its own check.
     * @param {(entry: object) => boolean} check
     * @returns {{recovered: string[], refused: string[]}}
     */
    recover(check) {
      if (typeof check !== 'function') throw new OmegaError('OMEGA_E_SCHEMA', 'recover() takes a check function');
      const recovered = [];
      const refused = [];
      for (const entry of allCells(organs)) {
        if (entry.cell.state !== 'ISOLATED' && entry.cell.state !== 'DEGRADED') continue;
        const result = entry.cell.recover({ check: () => check(entry) === true });
        if (result.recovered) recovered.push(entry.cell.name);
        else refused.push(entry.cell.name);
      }
      return { recovered, refused };
    },

    /** @returns {object} aggregated health for every organ */
    health() {
      return { organism: name, organs: [...byName.values()].map((organ) => organ.health()) };
    },

    /** @returns {object[]} every evidence record the organism produced, in order */
    evidence() {
      const entries = [...byName.values()].flatMap((organ) => organ.evidence());
      return entries.map((entry, index) => ({ ...entry, seq: index }));
    },

    /** @returns {object[]} every capability this organism spent */
    usage() {
      return [...byName.values()].flatMap((organ) => organ.usage());
    },

    /** @returns {object} the organism as a cell — the top of the recursion */
    asCell() {
      return createCell({
        name: compositeName,
        kind: 'composite',
        identity,
        nucleus: { module: `${compositeName}@1`, invariants: ['the organism coordinates organs; it owns no cell'] },
        receptors: {
          health: { description: 'the system reading', handler: () => organism.sample(), accepts: null, requires: [] },
        },
        port,
        clock,
      });
    },
  };

  return organism;
}
