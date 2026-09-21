/**
 * @nexa/policy — runtime boundary: provenance-based tool-request evaluation (v13-5).
 *
 * The boundary answers one question before Policy, gates, or the approval
 * ledger are consulted: *where did the intent to act come from?* Tool
 * descriptions, skill text, MCP metadata, page content, and model output
 * that relays them are content — never operator intent. Content may be
 * read; it may never act.
 *
 * The boundary is a pure deny-filter: it returns DENY, REQUIRE_APPROVAL, or
 * DEFER (let Policy + gates + ledger decide). It never returns ALLOW —
 * allowing is the job of the layers above, so a boundary bug can only
 * over-refuse, never over-permit.
 *
 * Every evaluation emits a deterministic event trail in the same vocabulary
 * the v13-4 timeline speaks, so a Security Lab finding links
 * prompt → decision → request → policy → authorization result with no
 * second source of truth.
 *
 * Pure module: deps limited to @nexa/ast, no fs, no net, no real time
 * (the clock is injected per call).
 */
import { NexaError, formatInstant } from '../../ast/index.js';

/**
 * Where a tool request claims its intent comes from.
 * Only `operator` and `mission-plan` (human-authored) count as intent;
 * `model-output` must be human-approved for exec-class actions;
 * `untrusted-content` (page/skill/tool-metadata text) can never act.
 */
export const TOOL_PROVENANCE = Object.freeze([
  'operator',
  'mission-plan',
  'model-output',
  'untrusted-content',
]);

/** Actions that read without mutating. Everything else is exec-class (fail closed). */
export const READ_CLASS_ACTIONS = Object.freeze(['get', 'list', 'read', 'stat']);

/** Verdicts the boundary may return (never ALLOW — see module note). */
export const BOUNDARY_VERDICTS = Object.freeze(['DENY', 'REQUIRE_APPROVAL', 'DEFER']);

function requireText(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new NexaError('NEXA_E_SCHEMA', `${name} must be a non-empty string of ≤ 1024 chars`);
  }
  return value;
}

function trail(now, types, detail) {
  const at = formatInstant(now());
  return types.map((type, seq) => ({ seq, at, type, detail: { ...detail } }));
}

const FULL_TRAIL = Object.freeze([
  'PROMPT_RECEIVED',
  'MODEL_DECISION',
  'TOOL_REQUESTED',
  'POLICY_EVALUATED',
  'AUTHORIZATION_RESULT',
]);

const SHORT_TRAIL = Object.freeze(['TOOL_REQUESTED', 'POLICY_EVALUATED', 'AUTHORIZATION_RESULT']);

/**
 * Evaluate one tool request at the provenance boundary.
 * @param {{provenance: string, resource: string, action: string, target?: string}} request
 * @param {{now?: () => Date}} [options] injected clock (deterministic in tests)
 * @returns {{verdict: string, code: string|null, reason: string, events: object[]}}
 */
export function evaluateToolRequest(
  { provenance, resource, action, target = null } = {},
  { now = () => new Date() } = {},
) {
  if (!TOOL_PROVENANCE.includes(provenance)) {
    return {
      verdict: 'DENY',
      code: 'NEXA_E_SCHEMA',
      reason: `unknown provenance ${JSON.stringify(provenance)} — failing closed`,
      events: trail(now, SHORT_TRAIL, { verdict: 'DENY', code: 'NEXA_E_SCHEMA' }),
    };
  }
  let clean;
  try {
    clean = {
      resource: requireText(resource, 'resource'),
      action: requireText(action, 'action'),
    };
  } catch (error) {
    return {
      verdict: 'DENY',
      code: error.code || 'NEXA_E_SCHEMA',
      reason: error.message,
      events: trail(now, SHORT_TRAIL, { verdict: 'DENY', code: error.code || 'NEXA_E_SCHEMA' }),
    };
  }
  if (target !== null && (typeof target !== 'string' || target.length > 4096)) {
    return {
      verdict: 'DENY',
      code: 'NEXA_E_SCHEMA',
      reason: 'target must be a string of ≤ 4096 chars or null',
      events: trail(now, SHORT_TRAIL, { verdict: 'DENY', code: 'NEXA_E_SCHEMA' }),
    };
  }

  const execClass = !READ_CLASS_ACTIONS.includes(clean.action);
  const detail = {
    provenance,
    resource: clean.resource,
    action: clean.action,
    target,
  };

  if (provenance === 'untrusted-content' && execClass) {
    return {
      verdict: 'DENY',
      code: 'NEXA_E_UNTRUSTED',
      reason:
        `untrusted content requested exec-class action ${clean.resource}/${clean.action} — ` +
        'content may be read, it may never act',
      events: trail(now, FULL_TRAIL, { ...detail, verdict: 'DENY', code: 'NEXA_E_UNTRUSTED' }),
    };
  }
  if (provenance === 'model-output' && execClass) {
    return {
      verdict: 'REQUIRE_APPROVAL',
      code: null,
      reason: 'model-originated exec-class action requires a human approval before Policy runs',
      events: trail(now, FULL_TRAIL, { ...detail, verdict: 'REQUIRE_APPROVAL', code: null }),
    };
  }
  return {
    verdict: 'DEFER',
    code: null,
    reason: 'provenance permits evaluation — Policy, gates, and the ledger decide',
    events: trail(
      now,
      provenance === 'operator' || provenance === 'mission-plan' ? SHORT_TRAIL : FULL_TRAIL,
      { ...detail, verdict: 'DEFER', code: null },
    ),
  };
}

/**
 * TOCTOU assertion: the observed execution target must equal the authorized
 * target byte-for-byte. Throws NEXA_E_APPROVAL_TARGET naming both sides.
 * @returns {{stable: true, authorized: string, observed: string}}
 */
export function assertTargetStable({ authorized, observed } = {}) {
  requireText(authorized, 'authorized');
  requireText(observed, 'observed');
  if (observed !== authorized) {
    throw new NexaError(
      'NEXA_E_APPROVAL_TARGET',
      `TARGET_CHANGED: authorized ${JSON.stringify(authorized)} but observed ${JSON.stringify(observed)}`,
    );
  }
  return { stable: true, authorized, observed };
}
