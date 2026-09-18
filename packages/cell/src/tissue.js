/**
 * The tissue — cells plus a contract.
 *
 * A tissue is not a bag of cells. It is a *topology*: who may talk to whom, about what, for
 * how long and how often. The contract **is** the grant set, so a message the contract does
 * not name has no capability to travel on and is refused twice over — once by the tissue
 * (route not declared, nothing minted) and once by the destination membrane (no token).
 *
 * The recursion lives here: a tissue that declares `entryPoints` builds a **composite cell**
 * that speaks for it. From above a tissue is a cell; from below it is a contract.
 */
import { OmegaError } from '../../compiler/index.js';
import { createIdentity } from '../../identity/index.js';
import { createCell } from './cell.js';
import { createGuarantor } from './guarantor.js';

/** @param {string} label @returns {string} a deterministic 32-byte seed derived from a label */
export function seedFor(label) {
  // A derivation, not a generation: the same label is the same key, and keys still belong
  // to the host. FNV-1a mixed twice and expanded to 32 bytes of hex.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const character of label) {
    const code = character.codePointAt(0);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  // `^` yields a signed 32-bit integer: without `>>> 0` a negative block renders `-7b…`
  // and stops being hex.
  const block = (value) => (value >>> 0).toString(16).padStart(8, '0');
  return (block(h1) + block(h2) + block(h1 ^ 0x5bf03635) + block(h2 ^ 0x27d4eb2f)).repeat(2).slice(0, 64);
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {object} input.operator the identity that may mint for this tissue
 * @param {object} [input.guarantor] a shared guarantor (organs share one across tissues)
 * @param {object[]} input.cells cells built by `createCell`
 * @param {Array<{from: string, to: string, receptor: string, ttl_ms?: number, max_calls?: number}>} [input.routes]
 * @param {Array<{to: string, receptor: string, as: string}>} [input.entryPoints] receptors the outside may use
 * @param {() => Date} [input.clock]
 */
export function createTissue({
  name,
  operator,
  guarantor = null,
  cells,
  routes = [],
  entryPoints = [],
  clock = () => new Date(),
}) {
  if (typeof name !== 'string' || name.length === 0) throw new OmegaError('OMEGA_E_SCHEMA', 'a tissue needs a name');
  if (!Array.isArray(cells) || cells.length === 0) throw new OmegaError('OMEGA_E_SCHEMA', 'a tissue needs at least one cell');

  const byName = new Map();
  for (const entry of cells) {
    const cell = entry.cell ?? entry;
    if (byName.has(cell.name)) throw new OmegaError('OMEGA_E_DUPLICATE', `two cells are named ${cell.name}`);
    // A cell of a tissue may only be handed the tissue's port — never an authority object.
    if (Object.hasOwn(cell, 'authority')) throw new OmegaError('OMEGA_E_CELL_AMPLIFY', `${cell.name} holds an authority`);
    byName.set(cell.name, cell);
  }

  const owner = guarantor ?? createGuarantor({ operator, clock });
  const compositeName = `${name}.tissue`;
  const declared = routes.filter((route) => byName.has(route.from));
  const entryRoutes = entryPoints.map((entry) => {
    if (!byName.has(entry.to)) throw new OmegaError('OMEGA_E_ROUTE', `entry point names an unknown cell: ${entry.to}`);
    return { from: compositeName, to: entry.to, receptor: entry.receptor };
  });
  owner.declare([...declared, ...entryRoutes]);
  const allowed = new Set([...declared, ...entryRoutes].map((route) => `${route.from}->${route.to}.${route.receptor}`));

  // The port is what a cell may hold: verification and recording, never minting. It is a
  // stable object per guarantor, which is how an organ proves its tissues share one authority.
  const port = { verify: (token, input) => owner.verify(token, input), record: (entry) => owner.record(entry) };

  const identity = createIdentity({ label: compositeName, kind: 'service', seed: seedFor(compositeName) });
  const receptors = {};
  for (const entry of entryPoints) {
    receptors[entry.as] = {
      description: `entry point toward ${entry.to}.${entry.receptor}, through the contract`,
      accepts: null,
      requires: [],
      // An entry point is not a shortcut: it goes back through `send`, so it mints a
      // capability and crosses the destination's membrane like any other call.
      handler: ({ payload }) => tissue.send({ from: compositeName, to: entry.to, receptor: entry.receptor, payload }),
    };
  }

  const composite = createCell({
    name: compositeName,
    kind: 'composite',
    identity,
    nucleus: { module: `${compositeName}@1`, invariants: ['a tissue speaks for its contract, not for its cells'] },
    receptors,
    port,
    clock,
  });
  byName.set(compositeName, composite);

  const tissue = {
    name,
    operator,
    cells: byName,
    composite,

    /** @returns {object[]} the cells' own descriptions */
    describe() {
      return [...byName.values()].map((cell) => cell.describe());
    },

    /** @returns {object[]} the contract, as data */
    contract() {
      return owner.topology().filter((route) => allowed.has(`${route.from}->${route.to}.${route.receptor}`));
    },

    /** @param {string} cellName @returns {object} */
    cell(cellName) {
      const cell = byName.get(cellName);
      if (cell === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `no cell ${cellName} in tissue ${name}`);
      return cell;
    },

    /** @returns {{verify: Function, record: Function}} the shareable half of the guarantor */
    port() {
      return port;
    },

    /**
     * Add routes this tissue may use — how an organ grants one of its cells the right to
     * call into another tissue. Declared before traffic, like every other route.
     * @param {object[]} extra
     * @returns {number} how many routes are now usable
     */
    allow(extra) {
      owner.declare(extra.filter((route) => byName.has(route.from)));
      for (const route of extra) {
        if (byName.has(route.from)) allowed.add(`${route.from}->${route.to}.${route.receptor}`);
      }
      return allowed.size;
    },

    /**
     * Deliver a proposal. The tissue mints, the destination membrane decides.
     * @param {{from: string, to: string, receptor: string, payload?: object, audience?: string[]}} message
     * @returns {object} the destination's verdict, or a route refusal
     */
    send(message) {
      const sender = byName.get(message.from);
      // A route declared by an organ can address a cell of another tissue; the caller then
      // supplies that cell as `target`. The route check is by name either way, so naming a
      // cell that this tissue may not reach is still a refusal.
      const target = byName.get(message.to) ?? message.target ?? null;
      if (sender === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `${message.from} is not a cell of ${name}`);
      if (target === undefined || target === null) {
        return { ok: false, code: 'OMEGA_E_ROUTE', reason: `${message.to} is not a cell of ${name}`, step: 'identity', detail: {} };
      }
      const refusalFor = (code, reason, step, detail) => {
        owner.record({
          kind: 'CELL_MESSAGE',
          decision: 'DENY',
          cell: message.to,
          from: message.from,
          receptor: message.receptor,
          detail: { step, code, reason },
        });
        return { ok: false, code, reason, step, detail };
      };
      if (!allowed.has(`${message.from}->${message.to}.${message.receptor}`)) {
        return refusalFor(
          'OMEGA_E_ROUTE',
          `${name} does not declare ${message.from} → ${message.to}.${message.receptor}`,
          'policy',
          { contract: tissue.contract().map((route) => `${route.from}->${route.to}.${route.receptor}`) },
        );
      }
      let issued;
      try {
        issued = owner.issue({ from: message.from, fromKid: sender.kid, to: message.to, receptor: message.receptor, args: message.payload ?? {} });
      } catch (cause) {
        return refusalFor(cause.code ?? 'OMEGA_E_GRANT_MISSING', cause.message, 'capability', {});
      }
      return target.receive({
        from: message.from,
        from_kid: sender.kid,
        receptor: message.receptor,
        payload: message.payload ?? {},
        capability: issued.token,
        ...(message.audience === undefined ? {} : { audience: message.audience }),
      });
    },

    /** @returns {object} aggregated health */
    health() {
      const cells = [...byName.values()].map((cell) => cell.metrics());
      const calls = cells.reduce((sum, entry) => sum + entry.calls, 0);
      const failures = cells.reduce((sum, entry) => sum + entry.failures, 0);
      return {
        tissue: name,
        cells,
        isolated: cells.filter((entry) => entry.state === 'ISOLATED').map((entry) => entry.cell),
        degraded: cells.filter((entry) => entry.state === 'DEGRADED').map((entry) => entry.cell),
        calls,
        failures,
        failure_rate_bp: calls === 0 ? 0 : Math.round((failures / calls) * 10_000),
      };
    },

    /** @returns {object[]} this tissue's evidence, in order */
    evidence() {
      return owner.entries();
    },

    /** @returns {object[]} per-route usage */
    usage() {
      return owner.usage();
    },

    /**
     * The recursion, made concrete. Throws when the tissue declares no entry points: a
     * bubble with no receptors is not addressable, so it is not a cell.
     * @returns {object} the composite cell
     */
    asCell() {
      if (entryPoints.length === 0) {
        throw new OmegaError('OMEGA_E_ROUTE', `${name} declares no entry points, so it has no outward receptors`);
      }
      return composite;
    },
  };

  return tissue;
}
