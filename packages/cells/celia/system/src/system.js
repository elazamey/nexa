/** Local composition only. No filesystem, network, effectful executor or default model. */
import { randomBytes } from 'node:crypto';
import { compile } from '../../../../compiler/index.js';
import { createIdentity } from '../../../../identity/index.js';
import { openSession, World, verifyOmegaChain } from '../../../../runtime/index.js';
import { EvidenceLog, verifyEvidenceChain } from '../../../../evidence/index.js';
import { observeRun, reflect } from '../../../../learning/index.js';
import { datasetStatus, rankPlans } from '../../learning/index.js';
import { exact, requireCondition as check } from '../../learning/src/data.js';
import { SYSTEM_LIMITS, boundedJSON, hash, planFingerprint, validateRequest } from './contracts.js';
import { ADVISORY_PROGRAM } from './program.js';
import { recommendSkills } from './library.js';
import { systemStatus, componentCatalog } from './catalog.js';

const compiled = compile(ADVISORY_PROGRAM);
check(compiled.ok, 'INVALID_ADVISORY_PROGRAM');
const stopped = () => { throw new Error('PROVIDERS_DISABLED'); };
const noProviders = Object.freeze({ providers: [], vault: { resolve: stopped }, invoke: stopped, describe: () => ({ enabled: false }) });

function assess(plans, reports) {
  return plans.map(plan => {
    const report = reports.get(plan.id) ?? null;
    const reasons = [];
    if (!report) reasons.push('MISSING_TEST_REPORT');
    else {
      if (report.counts.tests !== plan.expectedTests) reasons.push('TEST_COUNT_MISMATCH');
      if (report.exitCode !== 0) reasons.push('NONZERO_TEST_EXIT');
      for (const key of ['fail', 'cancelled', 'skipped', 'todo']) if (report.counts[key]) reasons.push(`TEST_${key.toUpperCase()}`);
    }
    if (plan.features.touchesSecurityBoundary) reasons.push('SECURITY_BOUNDARY_REQUIRES_SEPARATE_REVIEW');
    if (plan.features.testFilesChanged) reasons.push('TEST_CHANGES_REQUIRE_SEPARATE_REVIEW');
    if (plan.features.dependencyChanges) reasons.push('DEPENDENCY_CHANGES_REQUIRE_SEPARATE_REVIEW');
    const checksMet = report !== null && report.exitCode === 0 && report.counts.tests === plan.expectedTests
      && report.counts.pass === report.counts.tests;
    return {
      id: plan.id, strategy: plan.strategy, planHash: planFingerprint(plan),
      testAssessment: !report ? 'UNVERIFIED' : checksMet ? 'REPORTED_CHECKS_MET' : 'REPORTED_CHECKS_NOT_MET',
      report, reasons, humanReview: 'NOT_RECORDED_BY_THIS_SYSTEM',
      evidenceTrust: 'OPERATOR_SUPPLIED_NOT_EXECUTION_ATTESTATION', executionAllowed: false,
    };
  });
}
function learningStatus(observations) {
  return observations === null
    ? { connected: false, status: 'NOT_CONNECTED', samples: null, trained: false, advisoryOnly: true }
    : { ...datasetStatus(observations), connected: true, source: 'EXPLICIT_REVIEWED_ROWS', datasetHash: hash(observations) };
}
function rank(candidate, plans, assessments) {
  const ranked = candidate === null
    ? { recommendations: plans.map(p => ({ id: p.id, strategy: p.strategy, score: null, reason: 'NO_MODEL' })) }
    : rankPlans(candidate, plans);
  return {
    advisoryOnly: true, executionAllowed: false, calibrated: false, abstained: ranked.recommendations.every(r => r.score === null),
    model: candidate === null ? null : { modelHash: candidate.modelHash, status: 'USER_SUPPLIED_CANDIDATE_NOT_ATTESTED' },
    // Scores never erase failed checks. Preserve the experimental order, not approval.
    recommendations: ranked.recommendations.map(r => ({
      id: r.id, strategy: r.strategy, scoreBasisPoints: r.score === null ? null : Math.round(r.score * 10000),
      reason: r.reason, assessment: assessments.find(a => a.id === r.id).testAssessment, executionAllowed: false,
    })),
  };
}

/** Fresh runtime/keys/memory per call; only the fixed pure instruments receive grants. */
export function advise(request, options = {}) {
  check(options && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).every(key => ['observations', 'candidate'].includes(key)), 'INVALID_ADVISORY_OPTIONS');
  const { observations = null, candidate = null } = options;
  const { input, reports, requestHash } = validateRequest(request);
  const learning = learningStatus(observations);
  const model = candidate === null ? null : boundedJSON(candidate, SYSTEM_LIMITS.modelBytes);
  if (candidate !== null) rankPlans(model, input.plans); // Validate before starting any runtime.
  let proposals = null; let assessments = null; let ranking = null;
  const handlers = {
    planner: () => (proposals = { origin: 'OPERATOR_SUPPLIED_NOT_GENERATED', plans: input.plans.map(p => ({ id: p.id, strategy: p.strategy, planHash: planFingerprint(p) })) }),
    checker: () => (assessments = assess(input.plans, reports)),
    ranker: () => (ranking = rank(model, input.plans, assessments)),
  };
  const session = openSession({
    compiled, operator: createIdentity({ label: 'celia-advisory-local-host' }),
    kernelSeed: randomBytes(32).toString('hex'), agents: [{ name: 'adviser', seed: randomBytes(32).toString('hex') }],
    providers: noProviders, world: new World({ state: { advisory_context: { requestHash } } }),
    instruments: Object.entries(handlers).map(([name, handler]) => ({ resource: `tool:advisory-${name}`, handler })),
  });
  const outcome = session.runtime.run('advise');
  check(outcome.status === 'ALLOW' && proposals && assessments && ranking, 'ADVISORY_PIPELINE_FAILED');
  const observation = observeRun(outcome);
  const actor = session.kernel.agent('adviser');
  const { description, ...goal } = input.goal;
  const body = {
    version: 1, reporter: actor.kid, kernelActor: session.kernel.identity.kid,
    payload: {
      mode: 'ADVISORY_ONLY', executionAllowed: false, requestHash,
      goal: { ...goal, descriptionHash: hash(description) },
      workflow: { status: 'COMPLETED_LOCAL_ANALYSIS_ONLY', steps: outcome.plan.effective, receipts: outcome.receipts.length },
      proposals, assessments, ranking, learning,
      knowledge: recommendSkills(input, { modelLoaded: model !== null, learningConnected: observations !== null }),
      critique: { requiresHumanReview: true, automaticAcceptance: false, unresolvedBoundaries: systemStatus().blockers },
      memory: { scope: 'EPHEMERAL_DIGEST_ONLY', summary: outcome.memory },
      reflection: { scope: 'LOCAL_ANALYSIS_CALLS_NOT_PATCH_CORRECTNESS', observation, result: reflect({ observations: [observation] }) },
      system: systemStatus(),
    },
    evidence: { mission: outcome.ledger.entries(), kernel: session.kernel.endpoint.evidence.entries() },
  };
  const seal = new EvidenceLog({ actor });
  seal.append({ kind: 'HANDLER_RESULT', decision: 'INFO', subject: actor.kid, resource: 'advisory:report', action: 'assess', detail: { reportHash: hash(body), executionAllowed: false } });
  return { ...body, seal: seal.entries() };
}

/** Requires a signer pin supplied independently by the caller; no self-trust default. */
export function verifyAdvisoryReport(value, { expectedReporter } = {}) {
  check(typeof expectedReporter === 'string' && expectedReporter.length > 0, 'EXPECTED_REPORTER_REQUIRED');
  const report = boundedJSON(value, SYSTEM_LIMITS.reportBytes);
  exact(report, ['version', 'reporter', 'kernelActor', 'payload', 'evidence', 'seal']);
  const { seal, ...body } = report;
  check(report.version === 1 && report.reporter === expectedReporter, 'UNTRUSTED_REPORTER');
  check(report.payload.mode === 'ADVISORY_ONLY' && report.payload.executionAllowed === false, 'INVALID_ADVISORY_POSTURE');
  verifyEvidenceChain(seal, { expectActor: expectedReporter, expectLength: 1 });
  check(seal[0].kind === 'HANDLER_RESULT' && seal[0].decision === 'INFO' && seal[0].resource === 'advisory:report'
    && seal[0].action === 'assess' && seal[0].detail.executionAllowed === false && seal[0].detail.reportHash === hash(body), 'REPORT_INTEGRITY_ERROR');
  exact(report.evidence, ['mission', 'kernel']);
  check(Array.isArray(report.evidence.mission) && report.evidence.mission.length > 0
    && Array.isArray(report.evidence.kernel) && report.evidence.kernel.length > 0, 'INCOMPLETE_REPORT_EVIDENCE');
  const mission = verifyOmegaChain(report.evidence.mission, { expectActor: expectedReporter });
  check(mission.ok, 'INVALID_MISSION_EVIDENCE');
  verifyEvidenceChain(report.evidence.kernel, { expectActor: report.kernelActor });
  check(report.evidence.mission.at(-1).kind === 'MISSION_END', 'INCOMPLETE_REPORT_EVIDENCE');
  return { ok: true, integrityOnly: true, importedTestsAttested: false, executionAllowed: false, requestHash: report.payload.requestHash };
}
export { systemStatus, componentCatalog };
