/**
 * The six v0.1 hard gates.
 *
 * These are not configuration. They live in the request path *before* policy
 * rules, so no document, capability, caveat or peer can talk NEXA into opening
 * them. A gated request is a DENY with a machine-readable reason and an evidence
 * record — never a silent drop, and never a partial execution.
 */
import { NexaError } from '../../ast/index.js';

export const GATE_NAMES = Object.freeze([
  'REAL_EXECUTION',
  'TERMINAL',
  'FILESYSTEM_WRITE',
  'AUTO_COMMIT',
  'AUTO_PUSH',
  'AUTO_DEPLOY',
]);

/** Every gate is closed. There is no API to open one. */
export const GATE_STATE = Object.freeze(
  Object.fromEntries(GATE_NAMES.map((name) => [name, 'CLOSED'])),
);

/**
 * Resource namespaces that NEXA v0.1 refuses to touch, mapped to their gate.
 * Matching is namespace-prefix based: `fs:/etc` and `fs:` both hit FILESYSTEM_WRITE.
 */
export const GATED_RESOURCES = Object.freeze({
  exec: 'REAL_EXECUTION',
  shell: 'REAL_EXECUTION',
  process: 'REAL_EXECUTION',
  terminal: 'TERMINAL',
  tty: 'TERMINAL',
  fs: 'FILESYSTEM_WRITE',
  file: 'FILESYSTEM_WRITE',
  vcs: 'AUTO_COMMIT',
  git: 'AUTO_COMMIT',
  push: 'AUTO_PUSH',
  remote: 'AUTO_PUSH',
  deploy: 'AUTO_DEPLOY',
  release: 'AUTO_DEPLOY',
  infra: 'AUTO_DEPLOY',
});

/**
 * Actions that are always refused, whatever the resource. `vcs:status` (read) is
 * not here; `vcs:commit` is.
 */
export const GATED_ACTIONS = Object.freeze({
  commit: 'AUTO_COMMIT',
  push: 'AUTO_PUSH',
  merge: 'AUTO_PUSH',
  deploy: 'AUTO_DEPLOY',
  release: 'AUTO_DEPLOY',
  publish: 'AUTO_DEPLOY',
  write: 'FILESYSTEM_WRITE',
  delete: 'FILESYSTEM_WRITE',
  remove: 'FILESYSTEM_WRITE',
  move: 'FILESYSTEM_WRITE',
  chmod: 'FILESYSTEM_WRITE',
  exec: 'REAL_EXECUTION',
  spawn: 'REAL_EXECUTION',
  shell: 'REAL_EXECUTION',
});

/** @param {string} resource e.g. `fs:/tmp/x` @returns {string|null} namespace */
export function resourceNamespace(resource) {
  if (typeof resource !== 'string') return null;
  const colon = resource.indexOf(':');
  return colon === -1 ? resource : resource.slice(0, colon);
}

/**
 * @param {{resource?: string, action?: string}} request
 * @returns {{allowed: true} | {allowed: false, gate: string, reason: string}}
 */
export function checkGates({ resource, action } = {}) {
  const namespace = resourceNamespace(resource);
  if (namespace !== null && Object.hasOwn(GATED_RESOURCES, namespace)) {
    const gate = GATED_RESOURCES[namespace];
    return {
      allowed: false,
      gate,
      reason: `resource namespace "${namespace}" is behind the ${gate} gate`,
    };
  }
  if (typeof action === 'string' && Object.hasOwn(GATED_ACTIONS, action)) {
    const gate = GATED_ACTIONS[action];
    return {
      allowed: false,
      gate,
      reason: `action "${action}" is behind the ${gate} gate`,
    };
  }
  return { allowed: true };
}

/**
 * Throws when a request touches a closed gate. Used by the endpoint so the
 * refusal cannot be bypassed by a caller that skips the policy object.
 * @param {{resource?: string, action?: string}} request
 */
export function assertGateOpen(request) {
  const verdict = checkGates(request);
  if (!verdict.allowed) {
    throw new NexaError('NEXA_E_GATE', verdict.reason, {
      gate: verdict.gate,
      state: GATE_STATE[verdict.gate],
    });
  }
}

/** @returns {{name: string, state: string}[]} */
export function gatePosture() {
  return GATE_NAMES.map((name) => ({ name, state: GATE_STATE[name] }));
}
