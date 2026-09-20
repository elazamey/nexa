/** Operator-only collector. Separate from COMMIT authority and from HTTP. */
import fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetStatus, digest, exact, identifier, LIMITS, parseTestReport, requireCondition, validateObservation, validatePlan } from '../packages/cells/celia/learning/src/data.js';

const repository = resolve(fileURLToPath(new URL('../', import.meta.url)));
function statePath(value) {
  requireCondition(typeof value === 'string' && value.length > 0, 'EXPLICIT_STATE_DIRECTORY_REQUIRED');
  const path = resolve(value);
  requireCondition(path !== repository && !path.startsWith(repository + sep), 'STATE_MUST_BE_OUTSIDE_REPOSITORY');
  const stat = fs.lstatSync(path);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(path) === path
    && (stat.mode & 0o077) === 0 && typeof process.getuid === 'function' && stat.uid === process.getuid(), 'PRIVATE_STATE_DIRECTORY_REQUIRED');
  return path;
}
export function readBounded(path, limit = 32768) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    requireCondition(stat.isFile() && stat.size <= limit && stat.nlink === 1, 'INVALID_OR_OVERSIZED_FILE');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    requireCondition(size <= limit, 'OVERSIZED_FILE');
    return bytes.subarray(0, size).toString('utf8');
  } finally { fs.closeSync(fd); }
}
function saveNew(path, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  const fd = fs.openSync(path, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // No overwrite/reset command. Partial records after a fault fail on read;
  // this collector does NOT claim transactional or power-loss recovery.
}
function subdirectory(state, name) {
  const path = join(state, name);
  const stat = fs.lstatSync(path);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'UNSAFE_COLLECTION_DIRECTORY');
  return path;
}
function openState(value) {
  const state = statePath(value);
  const metadata = JSON.parse(readBounded(join(state, 'collection.json')));
  exact(metadata, ['format', 'createdAt']);
  requireCondition(metadata.format === 'celia-learning-v1' && Number.isFinite(Date.parse(metadata.createdAt)), 'UNKNOWN_COLLECTION');
  for (const area of ['plans', 'results', 'reviews']) subdirectory(state, area);
  return state;
}
export function initializeCollection(directory) {
  const state = statePath(directory); // operator supplies an existing empty 0700 directory
  requireCondition(fs.readdirSync(state).length === 0, 'COLLECTION_NOT_EMPTY');
  for (const area of ['plans', 'results', 'reviews']) fs.mkdirSync(join(state, area), { mode: 0o700 });
  saveNew(join(state, 'collection.json'), { format: 'celia-learning-v1', createdAt: new Date().toISOString() });
  return { status: 'COLLECTING', samples: 0, trained: false, executionAllowed: false };
}
const fileFor = (state, area, id) => { identifier(id); return join(subdirectory(state, area), digest(id) + '.json'); };
function readPlan(state, id) {
  const record = JSON.parse(readBounded(fileFor(state, 'plans', id)));
  exact(record, ['plan', 'planHash', 'registeredAt']);
  validatePlan(record.plan);
  requireCondition(record.plan.id === id && digest(record.plan) === record.planHash && Number.isFinite(Date.parse(record.registeredAt)), 'PLAN_INTEGRITY_ERROR');
  return record;
}
export function registerPlan(directory, plan) {
  validatePlan(plan);
  const state = openState(directory);
  requireCondition(fs.readdirSync(subdirectory(state, 'plans')).length < LIMITS.samples, 'COLLECTION_LIMIT');
  const record = { plan: structuredClone(plan), planHash: digest(plan), registeredAt: new Date().toISOString() };
  saveNew(fileFor(state, 'plans', plan.id), record);
  return { status: 'AWAITING_TEST_RESULT', id: plan.id, planHash: record.planHash, executionAllowed: false };
}
function readResult(state, id, planHash) {
  const result = JSON.parse(readBounded(fileFor(state, 'results', id)));
  exact(result, ['planId', 'planHash', 'reportHash', 'counts', 'exitCode', 'recordedAt']);
  requireCondition(result.planId === id && result.planHash === planHash && Number.isFinite(Date.parse(result.recordedAt)), 'RESULT_INTEGRITY_ERROR');
  return result;
}
export function recordResult(directory, input) {
  exact(input, ['planId', 'reportPath', 'exitCode']);
  const state = openState(directory);
  const record = readPlan(state, input.planId);
  requireCondition(typeof input.reportPath === 'string' && Number.isSafeInteger(input.exitCode) && input.exitCode >= 0 && input.exitCode <= 255, 'INVALID_RESULT');
  requireCondition(fs.lstatSync(input.reportPath).mtimeMs >= Date.parse(record.registeredAt), 'REPORT_PREDATES_REGISTERED_PLAN');
  const report = readBounded(input.reportPath, 1024 * 1024);
  const result = { planId: input.planId, planHash: record.planHash, reportHash: digest(report), counts: parseTestReport(report), exitCode: input.exitCode, recordedAt: new Date().toISOString() };
  saveNew(fileFor(state, 'results', input.planId), result);
  return { status: 'AWAITING_HUMAN_REVIEW', ...result, trained: false };
}
export function reviewResult(directory, input) {
  exact(input, ['planId', 'reviewer', 'accepted']);
  identifier(input.reviewer);
  requireCondition(typeof input.accepted === 'boolean', 'EXPLICIT_REVIEW_REQUIRED');
  const state = openState(directory);
  const plan = readPlan(state, input.planId);
  const result = readResult(state, input.planId, plan.planHash);
  saveNew(fileFor(state, 'reviews', input.planId), { ...input, resultHash: digest(result), reviewedAt: new Date().toISOString() });
  return { status: 'REVIEW_RECORDED', trained: false, executionAllowed: false };
}
export function loadCollection(directory) {
  const state = openState(directory);
  const names = fs.readdirSync(subdirectory(state, 'plans')).sort();
  requireCondition(names.length <= LIMITS.samples && names.every(name => /^[a-f0-9]{64}\.json$/.test(name)), 'INVALID_COLLECTION');
  const rows = [];
  let pendingResults = 0; let pendingReviews = 0;
  for (const name of names) {
    const raw = JSON.parse(readBounded(join(state, 'plans', name)));
    const { plan, planHash } = readPlan(state, raw.plan.id);
    requireCondition(digest(plan.id) + '.json' === name, 'PLAN_PATH_MISMATCH');
    if (!fs.existsSync(fileFor(state, 'results', plan.id))) { pendingResults++; continue; }
    const result = readResult(state, plan.id, planHash);
    if (!fs.existsSync(fileFor(state, 'reviews', plan.id))) { pendingReviews++; continue; }
    const review = JSON.parse(readBounded(fileFor(state, 'reviews', plan.id)));
    exact(review, ['planId', 'reviewer', 'accepted', 'resultHash', 'reviewedAt']);
    requireCondition(review.planId === plan.id && review.resultHash === digest(result) && Number.isFinite(Date.parse(review.reviewedAt)), 'REVIEW_INTEGRITY_ERROR');
    const { reportHash, exitCode, counts } = result;
    const evidence = { reportHash, exitCode, counts, reviewer: review.reviewer, accepted: review.accepted };
    const label = Number(evidence.accepted && exitCode === 0 && counts.tests === plan.expectedTests && counts.pass === counts.tests);
    rows.push(validateObservation({ plan, evidence, label }));
  }
  return { rows, status: { ...datasetStatus(rows), planned: names.length, pendingResults, pendingReviews } };
}
