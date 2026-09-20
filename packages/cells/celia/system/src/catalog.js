import { gatePosture } from '../../../../policy/index.js';
import { CATALOG_ROWS } from './catalog-data.js';
import { libraryStatus } from './library.js';

// Bindings name narrowly scoped, actual services. Audit maturity is independent.
const bindings = Object.freeze({
  A001: 'fixed-review-workflow', A003: 'runtime-reflection', A004: 'deterministic-critique',
  A005: 'supplied-tap-assessment', A012: 'pure-local-tools',
  A013: 'fixed-handler-registry', A026: 'ephemeral-digest-memory', A031: 'ephemeral-digest-memory',
  A042: 'structured-advisory-report', A044: 'closed-execution-surface', A045: 'core-policy',
  A046: 'local-analysis-authorization', A047: 'core-capabilities', A048: 'scoped-local-analysis-grants',
  A060: 'input-model-report-digests', A061: 'in-memory-signed-ledgers', A063: 'ed25519-integrity-only',
  A064: 'core-hash-chains', A079: 'local-step-budget', B074: 'pure-planner-executor-separation',
  B087: 'explicit-goal-contract', B080: 'fixed-review-workflow', B093: 'declared-risk-flags',
  B095: 'no-model-no-score', B100: 'sealed-advisory-provenance',
});
const blocked = new Set(['A006', 'A053', 'A054', 'A058', 'A059', 'A067', 'A068', 'B029']);
const conditional = Object.freeze({ A055: 'explicitly-reviewed-imported-data', A088: 'local-report-evaluation', B009: 'uncalibrated-candidate-score' });
export function componentCatalog() {
  return CATALOG_ROWS.map(([id, name, auditStatus, plannedPhase]) => ({
    id, name, auditStatus, plannedPhase,
    integration: bindings[id] ? 'CONNECTED_LIMITED' : blocked.has(id) ? 'BLOCKED' : conditional[id] ? 'CONDITIONAL_LOCAL_DATA' : 'NOT_CONNECTED',
    service: bindings[id] ?? conditional[id] ?? null,
    executionAllowed: false,
  }));
}
export function systemStatus() {
  const catalog = componentCatalog();
  const count = field => catalog.reduce((out, item) => { out[item[field]] = (out[item[field]] ?? 0) + 1; return out; }, {});
  return {
    name: 'Celia Advisory System', version: 1, mode: 'ADVISORY_ONLY', executionAllowed: false,
    gates: gatePosture(), catalog: { total: catalog.length, audit: count('auditStatus'), integration: count('integration') },
    blockers: ['H2_ATOMICITY_UNRESOLVED', 'H3_EXTERNAL_WRITER_CONCURRENCY_UNRESOLVED'],
    limitsSource: 'DECLARED_LIMITATIONS_NOT_A_FRESH_HARDENING_TEST',
    providers: { liveModel: 'NOT_CONNECTED', mockFallback: false, research: 'EXPLICIT_READ_ONLY_COMMAND_ONLY' },
    persistence: { workingMemory: 'PER_RUN_ONLY', evidence: 'RETURNED_NOT_AUTOMATICALLY_PERSISTED' },
    knowledgeLibrary: libraryStatus(),
    completeSystem: false,
  };
}
