/**
 * Shared test scaffolding.
 *
 * Everything is deterministic: fixed seeds, fixed clock, no network, no
 * filesystem, no process spawning. A test that needs real time is a bug.
 */
import { createIdentity } from '../packages/identity/index.js';
import { Policy } from '../packages/policy/index.js';
import { Endpoint } from '../packages/protocol/index.js';
import { mintCapability } from '../packages/capability/index.js';

export const T0 = new Date('2026-09-18T12:00:00Z');

export const SEEDS = {
  operator: 'a1'.repeat(32),
  agent: 'b2'.repeat(32),
  worker: 'c3'.repeat(32),
  outsider: 'd4'.repeat(32),
};

export const fixedClock = (when = T0) => () => when;

/** @param {{when?: Date}} [options] */
export function world({ when = T0 } = {}) {
  const clock = fixedClock(when);
  const operator = createIdentity({ label: 'operator', seed: SEEDS.operator });
  const agent = createIdentity({ label: 'agent-01', kind: 'agent', seed: SEEDS.agent });
  const worker = createIdentity({ label: 'worker-02', kind: 'agent', seed: SEEDS.worker });
  const outsider = createIdentity({ label: 'outsider', kind: 'peer', seed: SEEDS.outsider });

  const endpoint = new Endpoint({
    identity: agent,
    clock,
    policy: new Policy({
      rules: [
        { id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'], description: 'echo is a pure function' },
        { id: 'allow-add', effect: 'ALLOW', resource: 'tool:add', actions: ['call'], description: 'addition is a pure function' },
      ],
    }),
  });
  endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
  endpoint.registerHandler('tool:add', ({ args }) => ({ sum: args.a + args.b }));
  endpoint.registerHandler('tool:boom', () => {
    throw new Error('handler exploded');
  });
  endpoint.trust.pin(operator.document);
  endpoint.trust.pin(worker.document);
  endpoint.trust.pin(outsider.document);

  const caller = new Endpoint({ identity: operator, clock });
  caller.trust.pin(agent.document);

  return { clock, operator, agent, worker, outsider, endpoint, caller };
}

/**
 * @param {object} overrides
 * @returns {object} capability owned by `operator`, addressed to `agent`... or whoever
 */
export function capabilityFor(overrides = {}) {
  const {
    issuer,
    subject,
    resource = 'tool:echo',
    actions = ['call'],
    caveats = {},
    constraints = {},
  } = overrides;
  return mintCapability({
    issuer,
    subject,
    resource,
    actions,
    caveats: {
      nbf: '2026-09-18T11:00:00Z',
      exp: '2026-09-18T13:00:00Z',
      max_uses: 5,
      max_depth: 0,
      ...caveats,
    },
    constraints,
  });
}

/** Assert that `fn` throws a NexaError with `code`. */
export function throwsCode(assert, fn, code) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, code, `expected ${code}, got ${error.code ?? error} (${error.message})`);
    return error;
  }
  assert.fail(`expected ${code}, but nothing was thrown`);
  return undefined;
}
