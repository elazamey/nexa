import { canonicalBytes } from '../../../../ast/index.js';
import { createHash } from 'node:crypto';
import { validatePlan, parseTestReport } from '../../learning/index.js';
import { exact, identifier, requireCondition as check } from '../../learning/src/data.js';

export const SYSTEM_LIMITS = Object.freeze({ inputBytes: 2 * 1024 * 1024, reportBytes: 4 * 1024 * 1024, plans: 32, modelBytes: 256 * 1024 });
export const hash = value => createHash('sha256').update(canonicalBytes(value)).digest('hex');
// Versioned, canonical plan binding is intentionally separate from the collector's JSON digest.
export function planFingerprint(plan) { validatePlan(plan); return hash({ domain: 'celia-advisory-plan-v1', plan }); }
export function boundedJSON(value, limit) {
  const text = JSON.stringify(value);
  check(typeof text === 'string' && Buffer.byteLength(text) <= limit, 'SYSTEM_INPUT_LIMIT');
  return JSON.parse(text);
}
export function validateRequest(value) {
  const input = boundedJSON(value, SYSTEM_LIMITS.inputBytes);
  exact(input, ['version', 'operation', 'goal', 'plans', 'reports']);
  check(input.version === 1 && input.operation === 'advise', 'ADVISORY_ONLY_OPERATION');
  const g = input.goal;
  exact(g, ['id', 'description', 'taskGroup', 'baseHash', 'suiteHash', 'expectedTests']);
  identifier(g.id); identifier(g.taskGroup);
  check(typeof g.description === 'string' && g.description.trim().length > 0 && g.description.length <= 4000, 'INVALID_GOAL');
  check(Array.isArray(input.plans) && input.plans.length > 0 && input.plans.length <= SYSTEM_LIMITS.plans, 'INVALID_PLAN_BATCH');
  const plans = new Map();
  for (const plan of input.plans) {
    validatePlan(plan);
    check(!plans.has(plan.id), 'DUPLICATE_PLAN');
    for (const field of ['taskGroup', 'baseHash', 'suiteHash', 'expectedTests']) check(g[field] === plan[field], 'GOAL_PLAN_BINDING_MISMATCH');
    plans.set(plan.id, plan);
  }
  check(Array.isArray(input.reports) && input.reports.length <= input.plans.length, 'INVALID_REPORT_BATCH');
  const reports = new Map();
  for (const report of input.reports) {
    exact(report, ['planId', 'planHash', 'tap', 'exitCode']);
    check(plans.has(report.planId) && !reports.has(report.planId), 'UNKNOWN_OR_DUPLICATE_REPORT_PLAN');
    check(report.planHash === planFingerprint(plans.get(report.planId)), 'REPORT_PLAN_BINDING_MISMATCH');
    check(Number.isSafeInteger(report.exitCode) && report.exitCode >= 0 && report.exitCode <= 255, 'INVALID_EXIT_CODE');
    const counts = parseTestReport(report.tap);
    reports.set(report.planId, { counts, exitCode: report.exitCode, reportHash: hash(report.tap), planHash: report.planHash });
  }
  return { input, reports, requestHash: hash(input) };
}
