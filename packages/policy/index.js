/**
 * @nexa/policy — hard gates + default-deny rule evaluation.
 */
export {
  GATE_NAMES,
  GATE_STATE,
  GATED_RESOURCES,
  GATED_ACTIONS,
  resourceNamespace,
  checkGates,
  assertGateOpen,
  gatePosture,
} from './src/gates.js';
export { Policy, RULE_EFFECTS, DEFAULT_POLICY_ID, validateRule } from './src/rules.js';
export {
  TOOL_PROVENANCE,
  READ_CLASS_ACTIONS,
  BOUNDARY_VERDICTS,
  PROVENANCE_RANK,
  evaluateToolRequest,
  assertTargetStable,
  downgradeProvenance,
} from './src/boundary.js';
export {
  ApprovalLedger,
  isApprovalEligible,
  APPROVAL_ELIGIBLE_GATES,
  ROOT_NAMESPACES,
  APPROVAL_DEFAULT_TTL_SECONDS,
  APPROVAL_MAX_TTL_SECONDS,
} from './src/approval.js';

import { Policy, RULE_EFFECTS } from './src/rules.js';

/**
 * Convenience builder: `allowOn('tool:*', ['call'])` style rules, sorted by id.
 * @param {[string, string, ('ALLOW'|'DENY')?][]} entries [resourceId, actionsCsv, effect]
 * @returns {Policy}
 */
export function policyFromMatrix(entries) {
  const rules = entries.map(([resource, actionsCsv, effect = 'ALLOW'], index) => ({
    id: `rule-${String(index).padStart(3, '0')}`,
    effect: effect && RULE_EFFECTS.includes(effect) ? effect : 'DENY',
    resource,
    actions: String(actionsCsv).split(',').map((action) => action.trim()).filter(Boolean),
    description: `${effect ?? 'ALLOW'} ${actionsCsv} on ${resource}`,
  }));
  return new Policy({ rules });
}
