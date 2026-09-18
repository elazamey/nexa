/**
 * The organ — tissues plus a contract, and a cell from above.
 *
 * An organ coordinates tissues: cross-tissue routes are declared *here*, which means the
 * right of a cell in one tissue to call a cell in another is an explicit decision that
 * lands in the source tissue's contract too. Nothing is implicit — if the organ's contract
 * does not name `coding.coder → memory.archivist`, the call has no capability to travel on.
 *
 * One organ is one authority: every tissue must share the same guarantor, because two
 * guarantors would mean two answers to "may this call happen?".
 */
import { OmegaError } from '../../compiler/index.js';
import { createIdentity } from '../../identity/index.js';
import { createCell } from './cell.js';
import { seedFor } from './tissue.js';

/**
 * @param {object} input
 * @param {string} input.name
 * @param {object} input.operator
 * @param {object[]} input.tissues tissues built by `createTissue` over a shared guarantor
 * @param {Array<{from: string|{tissue: string, cell: string}, to: string|{tissue: string, cell: string},
 *                receptor: string, ttl_ms?: number, max_calls?: number}>} [input.routes]
 * @param {Array<{from: string, to: string|{tissue: string, cell: string}, receptor: string, as: string}>} [input.entryPoints]
 * @param {() => Date} [input.clock]
 */
export function createOrgan({ name, operator, tissues, routes = [], entryPoints = [], clock = () => new Date() }) {
  if (!Array.isArray(tissues) || tissues.length === 0) throw new OmegaError('OMEGA_E_SCHEMA', 'an organ needs at least one tissue');
  const byName = new Map();
  for (const tissue of tissues) {
    if (byName.has(tissue.name)) throw new OmegaError('OMEGA_E_DUPLICATE', `two tissues are named ${tissue.name}`);
    byName.set(tissue.name, tissue);
  }
  // One organ, one authority. Two guarantors would mean two grant sets and two answers.
  if (tissues.some((tissue) => tissue.port() !== tissues[0].port())) {
    throw new OmegaError('OMEGA_E_CELL_AMPLIFY', `${name}: every tissue of an organ must share one guarantor`);
  }
  const port = tissues[0].port();

  const flatten = (reference, where) => {
    if (typeof reference === 'string') {
      // `tissue.cell` is the shorthand; a bare cell name must be unambiguous.
      const [tissueName, cellName] = reference.includes('.') ? reference.split('.') : [null, reference];
      if (tissueName !== null) return { tissue: tissueName, cell: cellName };
      const owners = tissues.filter((tissue) => tissue.cells.has(cellName));
      if (owners.length !== 1) {
        throw new OmegaError('OMEGA_E_ROUTE', `${where}: ${cellName} is ${owners.length === 0 ? 'not a cell of this organ' : 'ambiguous'}`);
      }
      return { tissue: owners[0].name, cell: cellName };
    }
    return { tissue: reference?.tissue, cell: reference?.cell };
  };

  const crossRoutes = routes.map((route) => {
    const from = flatten(route.from, `${name} route`);
    const to = flatten(route.to, `${name} route`);
    const source = byName.get(from.tissue);
    const destination = byName.get(to.tissue);
    if (source === undefined || destination === undefined) throw new OmegaError('OMEGA_E_ROUTE', `${name} route names an unknown tissue`);
    if (!source.cells.has(from.cell) || !destination.cells.has(to.cell)) {
      throw new OmegaError('OMEGA_E_ROUTE', `${name} route names an unknown cell`);
    }
    return {
      from: from.cell,
      to: to.cell,
      receptor: route.receptor,
      ...(route.ttl_ms === undefined ? {} : { ttl_ms: route.ttl_ms }),
      ...(route.max_calls === undefined ? {} : { max_calls: route.max_calls }),
    };
  });

  // The source tissue learns it may call outward. The destination tissue learns nothing:
  // receiving is not a right, it is a membrane decision.
  for (const route of crossRoutes) {
    const sourceTissue = [...byName.values()].find((tissue) => tissue.cells.has(route.from));
    sourceTissue.allow([route]);
  }

  // An entry point is a route *into* this organ. The caller is the organ's own composite
  // cell — the recursion again: from outside, an organ is a cell with receptors.
  const entries = entryPoints.map((entry) => {
    const target = flatten(entry.to, `${name} entry point`);
    const destination = byName.get(target.tissue);
    if (destination === undefined || !destination.cells.has(target.cell)) {
      throw new OmegaError('OMEGA_E_ROUTE', `${name} entry point names an unknown cell`);
    }
    return { ...entry, tissue: target.tissue, cell: target.cell };
  });
  for (const entry of entries) {
    byName.get(entry.tissue).allow([{ from: `${name}.organ`, to: entry.cell, receptor: entry.receptor }]);
  }

  // The organ's own membrane: the organ is a cell, so an external caller is a cell too.
  const compositeName = `${name}.organ`;
  const identity = createIdentity({ label: compositeName, kind: 'service', seed: seedFor(compositeName) });
  const receptors = {};
  for (const entry of entries) {
    receptors[entry.as] = {
      description: `entry point toward ${entry.tissue}.${entry.cell}.${entry.receptor}`,
      accepts: null,
      requires: [],
      handler: ({ payload }) => organ.send({
        from: { tissue: entry.tissue, cell: `${name}.organ` },
        to: { tissue: entry.tissue, cell: entry.cell },
        receptor: entry.receptor,
        payload,
      }),
    };
  }
  const composite = createCell({
    name: compositeName,
    kind: 'composite',
    identity,
    nucleus: { module: `${compositeName}@1`, invariants: ['an organ coordinates tissues; it does not hold their cells'] },
    receptors,
    port,
    clock,
  });

  const organ = {
    name,
    operator,
    tissues: byName,
    composite,

    /** @param {{from: object|string, to: object|string, receptor: string}} route @returns {boolean} */
    allows(route) {
      const from = flatten(route.from, `${name} allows`);
      const to = flatten(route.to, `${name} allows`);
      return crossRoutes.some((entry) => entry.from === from.cell && entry.to === to.cell && entry.receptor === route.receptor);
    },

    /** @returns {object[]} the organ's cross-tissue contract, as data */
    contract() {
      return crossRoutes.map((route) => ({ ...route }));
    },

    /** @returns {object} the organ's topology: every tissue's contract, plus the cross routes */
    topology() {
      return {
        organ: name,
        tissues: [...byName.values()].map((tissue) => ({ tissue: tissue.name, contract: tissue.contract() })),
        routes: organ.contract(),
      };
    },

    /**
     * @param {{from: string, to: string, receptor: string, payload?: object, audience?: string[]}} message
     *   `from` and `to` are `tissue.cell` references.
     * @returns {object} the verdict
     */
    send(message) {
      const from = flatten(message.from, `${name} send`);
      const to = flatten(message.to, `${name} send`);
      const destination = byName.get(to.tissue);
      if (destination === undefined) {
        return { ok: false, code: 'OMEGA_E_ROUTE', reason: `${to.tissue} is not a tissue of ${name}`, step: 'identity', detail: {} };
      }
      const source = byName.get(from.tissue);
      if (source === undefined) {
        return { ok: false, code: 'OMEGA_E_ROUTE', reason: `${from.tissue} is not a tissue of ${name}`, step: 'identity', detail: {} };
      }
      if (from.tissue === to.tissue) {
        // Inside one tissue the tissue's contract decides; the organ does not intervene.
        return source.send({
          from: from.cell,
          to: to.cell,
          receptor: message.receptor,
          payload: message.payload ?? {},
          ...(message.audience === undefined ? {} : { audience: message.audience }),
        });
      }
      const declared = crossRoutes.some((route) => route.from === from.cell && route.to === to.cell && route.receptor === message.receptor);
      if (!declared) {
        return {
          ok: false,
          code: 'OMEGA_E_ROUTE',
          reason: `${name} does not declare ${from.tissue}.${from.cell} → ${to.tissue}.${to.cell}.${message.receptor}`,
          step: 'policy',
          detail: { contract: organ.contract().map((route) => `${route.from}->${route.to}.${route.receptor}`) },
        };
      }
      return source.send({
        from: from.cell,
        to: to.cell,
        receptor: message.receptor,
        payload: message.payload ?? {},
        // Cross-tissue: the destination cell travels with the message, so the source
        // tissue mints for a route it was given, and the destination membrane decides.
        target: destination.cells.get(to.cell),
        ...(message.audience === undefined ? {} : { audience: message.audience }),
      });
    },

    /** @returns {object} aggregated health */
    health() {
      const tissues = [...byName.values()].map((tissue) => tissue.health());
      const calls = tissues.reduce((sum, entry) => sum + entry.calls, 0);
      const failures = tissues.reduce((sum, entry) => sum + entry.failures, 0);
      return {
        organ: name,
        tissues,
        calls,
        failures,
        failure_rate_bp: calls === 0 ? 0 : Math.round((failures / calls) * 10_000),
        isolated: tissues.flatMap((entry) => entry.isolated),
        degraded: tissues.flatMap((entry) => entry.degraded),
      };
    },

    /** @returns {object[]} evidence from every tissue, tagged with its tissue */
    evidence() {
      return [...byName.values()].flatMap((tissue) => tissue.evidence().map((entry) => ({ tissue: tissue.name, ...entry })));
    },

    /** @returns {object[]} per-route usage across the organ */
    usage() {
      return [...byName.values()].flatMap((tissue) => tissue.usage().map((entry) => ({ tissue: tissue.name, ...entry })));
    },

    /** @returns {object} the organ as a cell (the recursion) */
    asCell() {
      if (entryPoints.length === 0) throw new OmegaError('OMEGA_E_ROUTE', `${name} declares no entry points`);
      return composite;
    },
  };

  return organ;
}
