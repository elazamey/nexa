/** Learning data only; not protocol messages, permission grants or receipts. */
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ samples: 2000, minimumSamples: 120, minimumGroups: 15, minimumPerStrategy: 20 });
export const FEATURE_LIMITS = Object.freeze({ changedFiles: 128, changedLines: 10000, dependencyChanges: 32, baselineFailures: 1024, testFilesChanged: 128, touchesSecurityBoundary: 1 });
export const FEATURES = Object.freeze(Object.keys(FEATURE_LIMITS));
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function requireCondition(condition, code) { if (!condition) throw new Error(code); }
export function exact(value, keys) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'INVALID_FIELDS');
}
export function identifier(value) {
  requireCondition(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/.test(value), 'INVALID_IDENTIFIER');
}
export function validateFeatures(features) {
  exact(features, FEATURES);
  for (const name of FEATURES) requireCondition(Number.isSafeInteger(features[name]) && features[name] >= 0 && features[name] <= FEATURE_LIMITS[name], 'INVALID_FEATURE');
  return features;
}
export function validatePlan(plan) {
  exact(plan, ['id', 'taskGroup', 'strategy', 'features', 'baseHash', 'patchHash', 'suiteHash', 'expectedTests', 'researchIds']);
  for (const name of ['id', 'taskGroup', 'strategy']) identifier(plan[name]);
  validateFeatures(plan.features);
  for (const name of ['baseHash', 'patchHash', 'suiteHash']) requireCondition(typeof plan[name] === 'string' && /^[a-f0-9]{64}$/.test(plan[name]), 'INVALID_DIGEST');
  requireCondition(Number.isSafeInteger(plan.expectedTests) && plan.expectedTests > 0 && plan.expectedTests <= 100000, 'INVALID_TEST_COUNT');
  requireCondition(Array.isArray(plan.researchIds) && plan.researchIds.length <= 5 && plan.researchIds.every(id => /^\d{4}\.\d{4,5}(v\d+)?$/.test(id)), 'INVALID_RESEARCH_IDS');
  return plan;
}

/** Parses a completed Node test-run summary, not an LLM's assessment of success. */
export function parseTestReport(text) {
  requireCondition(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024 && text.includes('TAP version 13'), 'INVALID_TEST_REPORT');
  const result = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...text.matchAll(new RegExp(`^# ${key} ([0-9]+)\\r?$`, 'gm'))];
    requireCondition(matches.length === 1, 'AMBIGUOUS_OR_INCOMPLETE_TEST_REPORT');
    result[key] = Number(matches[0][1]);
    requireCondition(Number.isSafeInteger(result[key]) && result[key] <= 100000, 'INVALID_TEST_COUNT');
  }
  requireCondition(/^# duration_ms [0-9]+(?:\.[0-9]+)?\s*$/.test(text.trimEnd().split('\n').at(-1)), 'INCOMPLETE_TEST_REPORT');
  requireCondition(result.tests > 0 && result.tests === result.pass + result.fail + result.cancelled + result.skipped + result.todo, 'INCONSISTENT_TEST_REPORT');
  return result;
}

export function makeObservation(plan, { report, exitCode, reviewer, accepted }) {
  validatePlan(plan);
  identifier(reviewer);
  requireCondition(typeof accepted === 'boolean' && Number.isSafeInteger(exitCode) && exitCode >= 0 && exitCode <= 255, 'INVALID_REVIEW');
  const counts = parseTestReport(report);
  // Changed test count, skipped tests, TODOs, cancellation and rejection are NOT successes.
  const label = Number(accepted && exitCode === 0 && counts.tests === plan.expectedTests
    && counts.pass === counts.tests && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0);
  return { plan: structuredClone(plan), evidence: { reportHash: digest(report), exitCode, reviewer, accepted, counts }, label };
}

export function validateObservation(row) {
  exact(row, ['plan', 'evidence', 'label']);
  validatePlan(row.plan);
  exact(row.evidence, ['reportHash', 'exitCode', 'reviewer', 'accepted', 'counts']);
  const e = row.evidence;
  identifier(e.reviewer);
  requireCondition(/^[a-f0-9]{64}$/.test(e.reportHash) && Number.isSafeInteger(e.exitCode) && e.exitCode >= 0 && e.exitCode <= 255 && typeof e.accepted === 'boolean', 'INVALID_EVIDENCE');
  exact(e.counts, ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']);
  for (const value of Object.values(e.counts)) requireCondition(Number.isSafeInteger(value) && value >= 0 && value <= 100000, 'INVALID_TEST_COUNT');
  requireCondition(e.counts.tests > 0 && e.counts.tests === e.counts.pass + e.counts.fail + e.counts.cancelled + e.counts.skipped + e.counts.todo, 'INVALID_TEST_COUNT');
  const label = Number(e.accepted && e.exitCode === 0 && e.counts.tests === row.plan.expectedTests && e.counts.pass === e.counts.tests);
  requireCondition(row.label === label, 'LABEL_MISMATCH');
  return row;
}

export function datasetStatus(rows) {
  requireCondition(Array.isArray(rows) && rows.length <= LIMITS.samples, 'DATASET_LIMIT');
  const ids = new Set();
  const attempts = new Set();
  const strategies = new Map();
  const groups = new Set();
  for (const row of rows) {
    validateObservation(row);
    // Renaming an identical attempt must not inflate the apparent evidence.
    const attempt = digest([row.plan.taskGroup, row.plan.baseHash, row.plan.patchHash, row.plan.suiteHash]);
    requireCondition(!ids.has(row.plan.id) && !attempts.has(attempt), 'DUPLICATE_ATTEMPT');
    ids.add(row.plan.id); attempts.add(attempt); groups.add(row.plan.taskGroup);
    strategies.set(row.plan.strategy, (strategies.get(row.plan.strategy) ?? 0) + 1);
  }
  const reasons = [];
  if (rows.length < LIMITS.minimumSamples) reasons.push('INSUFFICIENT_REAL_OBSERVATIONS');
  if (groups.size < LIMITS.minimumGroups) reasons.push('INSUFFICIENT_TASK_GROUPS');
  if (strategies.size < 2 || strategies.size > 16 || [...strategies.values()].some(n => n < LIMITS.minimumPerStrategy)) reasons.push('INSUFFICIENT_STRATEGY_COVERAGE');
  return { status: reasons.length ? 'COLLECTING' : 'READY_FOR_SPLIT_CHECK', samples: rows.length, groups: groups.size, strategies: Object.fromEntries(strategies), reasons, trained: false, advisoryOnly: true };
}

/** Fixed group assignment: attempts for the SAME issue cannot cross splits. */
export function splitName(taskGroup) {
  const bucket = parseInt(digest(`celia-learning-split-v1:${taskGroup}`).slice(0, 8), 16) % 10;
  return bucket < 6 ? 'train' : bucket < 8 ? 'validation' : 'test';
}
export function splitDataset(rows) {
  const status = datasetStatus(rows);
  requireCondition(status.reasons.length === 0, status.reasons.join(','));
  const parts = { train: [], validation: [], test: [] };
  for (const row of rows) parts[splitName(row.plan.taskGroup)].push(row);
  for (const [name, part] of Object.entries(parts)) {
    requireCondition(part.length >= (name === 'train' ? 60 : 20), `INSUFFICIENT_${name.toUpperCase()}_DATA`);
    for (const label of [0, 1]) requireCondition(part.filter(row => row.label === label).length >= 5, `MISSING_${name.toUpperCase()}_CLASS_COVERAGE`);
    for (const strategy of Object.keys(status.strategies)) requireCondition(part.some(row => row.plan.strategy === strategy), `MISSING_${name.toUpperCase()}_STRATEGY_COVERAGE`);
  }
  return parts;
}
