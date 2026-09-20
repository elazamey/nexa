import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { datasetStatus, makeObservation, parseTestReport, splitDataset, validatePlan } from '../packages/cells/celia/learning/index.js';
import { digest, splitName } from '../packages/cells/celia/learning/src/data.js';
import { createModel, lossAndGradient, predict, rankPlans, trainCandidate, validateModel } from '../packages/cells/celia/learning/src/models.js';
import { initializeCollection, loadCollection, recordResult, registerPlan, reviewResult } from '../tools/celia-learning-store.mjs';
import { fetchResearch, parseArxivFeed } from '../tools/celia-learning-research.mjs';

const report = ({ pass = 2, fail = 0, skipped = 0, todo = 0, cancelled = 0 } = {}) => `TAP version 13\n# tests ${pass + fail + skipped + todo + cancelled}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n# duration_ms 12.5\n`;
function plan(id = 'attempt-1', group = 'repo:issue-1') {
  return { id, taskGroup: group, strategy: 'minimal-fix', features: { changedFiles: 1, changedLines: 10, dependencyChanges: 0, baselineFailures: 1, testFilesChanged: 0, touchesSecurityBoundary: 0 }, baseHash: digest('base'), patchHash: digest(id), suiteHash: digest('suite'), expectedTests: 2, researchIds: [] };
}
function row(p = plan(), accepted = true, text = report()) {
  return makeObservation(p, { report: text, exitCode: text.includes('# fail 0\n') ? 0 : 1, reviewer: 'test-fixture-reviewer', accepted });
}
// SYNTHETIC fixtures ONLY: numerical/ML tests. Never added to a user's collection.
function numericalFixture() {
  const rows = [];
  for (let group = 0; group < 50; group++) for (let attempt = 0; attempt < 8; attempt++) {
    const p = plan(`synthetic-${group}-${attempt}`, `synthetic-repo:issue-${group}`);
    p.strategy = attempt < 4 ? 'minimal-fix' : 'revert-change';
    const success = attempt % 2 === 0;
    p.features.changedFiles = success ? 1 : 100;
    p.features.changedLines = success ? 10 : 9000;
    p.features.dependencyChanges = success ? 0 : 20;
    rows.push(row(p, true, success ? report() : report({ pass: 1, fail: 1 })));
  }
  return rows;
}
function temp(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'nexa-learning-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const childEnv = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const cli = fileURLToPath(new URL('../tools/celia-learning.mjs', import.meta.url));
function runCLI(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000, env: childEnv });
  assert.ifError(result.error);
  return result;
}

test('learning: collecting starts empty; training refuses to invent missing evidence', () => {
  assert.equal(datasetStatus([]).status, 'COLLECTING');
  assert.equal(datasetStatus([]).trained, false);
  for (const family of ['ml', 'dl']) assert.throws(() => trainCandidate([], { family }), /INSUFFICIENT/);
});
test('learning: strict bounded pre-outcome schema rejects arbitrary fields, NaN and oversized features', () => {
  assert.equal(validatePlan(plan()).expectedTests, 2);
  for (const bad of [{ ...plan(), authorization: 'ALLOW' }, { ...plan(), patchHash: 'missing' }]) assert.throws(() => validatePlan(bad));
  for (const value of [NaN, Infinity, -1, 129, 1.2]) {
    const p = plan(); p.features.changedFiles = value;
    assert.throws(() => validatePlan(p), /INVALID_FEATURE/);
  }
});
test('learning: malformed, incomplete and duplicated TAP summaries are not evidence of success', () => {
  assert.equal(parseTestReport(report()).pass, 2);
  for (const bad of ['success!', report() + report(), report().replace('# duration_ms 12.5', ''), report().replace('# tests 2', '# tests 99')]) assert.throws(() => parseTestReport(bad));
});
test('learning: reward cannot hide failures, skipped tests, missing tests, exit failure or human rejection', () => {
  assert.equal(row().label, 1);
  assert.equal(row(plan(), false).label, 0);
  for (const counts of [{ pass: 1, fail: 1 }, { pass: 1, skipped: 1 }, { pass: 1, todo: 1 }, { pass: 1, cancelled: 1 }, { pass: 1 }]) assert.equal(row(plan(), true, report(counts)).label, 0);
  assert.equal(makeObservation(plan(), { report: report(), exitCode: 1, accepted: true, reviewer: 'fixture' }).label, 0);
});
test('learning: duplicated attempts and forged labels do not increase data readiness', () => {
  const first = row();
  assert.throws(() => datasetStatus([first, structuredClone(first)]), /DUPLICATE/);
  const renamed = structuredClone(first); renamed.plan.id = 'another-id';
  assert.throws(() => datasetStatus([first, renamed]), /DUPLICATE/);
  first.label = 0;
  assert.throws(() => datasetStatus([first]), /LABEL_MISMATCH/);
});
test('learning: task groups never cross train/validation/test, and class coverage is required', () => {
  const rows = numericalFixture();
  const parts = splitDataset(rows);
  const membership = new Map();
  for (const [name, part] of Object.entries(parts)) for (const entry of part) {
    const group = entry.plan.taskGroup;
    assert.equal(splitName(group), name);
    assert.ok(!membership.has(group) || membership.get(group) === name);
    membership.set(group, name);
  }
  assert.throws(() => splitDataset(rows.map(entry => row(entry.plan))), /CLASS_COVERAGE/);
});
for (const family of ['ml', 'dl']) {
  test(`learning ${family}: all weight and bias derivatives agree with finite differences`, () => {
    const model = createModel(family, ['minimal-fix', 'revert-change']);
    const x = [-0.3, 0.2, -0.1, 0.4, 0.1, -0.2, 1, 0];
    const { gradient } = lossAndGradient(model, x, 1);
    const epsilon = 1e-5;
    function check(container, index, expected) {
      const original = container[index];
      container[index] = original + epsilon; const plus = lossAndGradient(model, x, 1).loss;
      container[index] = original - epsilon; const minus = lossAndGradient(model, x, 1).loss;
      container[index] = original;
      assert.ok(Math.abs((plus - minus) / (2 * epsilon) - expected) < 1e-6);
    }
    for (let l = 0; l < model.layers.length; l++) for (let j = 0; j < model.layers[l].weights.length; j++) {
      check(model.layers[l].biases, j, gradient[l].biases[j]);
      model.layers[l].weights[j].forEach((_, i) => check(model.layers[l].weights[j], i, gradient[l].weights[j][i]));
    }
  });
  test(`learning ${family}: real gradient updates improve held-out loss on explicitly synthetic fixtures`, () => {
    const rows = numericalFixture();
    const before = JSON.stringify(rows);
    const candidate = trainCandidate(rows, { family });
    assert.notEqual(candidate.modelHash, candidate.initialWeightsHash);
    assert.ok(candidate.validation.logLoss < candidate.validation.baselineLogLoss * 0.5);
    assert.ok(candidate.test.logLoss < candidate.test.baselineLogLoss * 0.5);
    assert.equal(candidate.executionAllowed, false);
    assert.equal(candidate.status, 'CANDIDATE_ONLY');
    assert.equal(candidate.model.layers.length, family === 'dl' ? 3 : 1);
    const restored = JSON.parse(JSON.stringify(candidate));
    assert.equal(predict(candidate.model, rows[0].plan), predict(restored.model, rows[0].plan));
    const ranked = rankPlans(restored, [rows[1].plan, rows[0].plan, { ...plan('unknown'), strategy: 'never-seen' }]);
    assert.equal(ranked.recommendations[0].id, rows[0].plan.id);
    assert.equal(ranked.recommendations.at(-1).score, null);
    assert.equal(ranked.executionAllowed, false);
    assert.equal(JSON.stringify(rows), before, 'training must not relabel or mutate observations');
  });
}
test('learning: candidate integrity, architecture and finite weights are checked before inference', () => {
  const model = createModel('dl', ['a', 'b']);
  model.layers[0].weights[0][0] = NaN;
  assert.throws(() => validateModel(model), /WEIGHTS/);
  model.layers[0].weights[0][0] = 0;
  model.layers.push(model.layers[0]);
  assert.throws(() => validateModel(model), /ARCHITECTURE/);
  assert.throws(() => rankPlans({ version: 1, status: 'CANDIDATE_ONLY', modelHash: 'forged', model }, [plan()]), /CANDIDATE/);
});

test('learning collector: actual Node test run persists across CLI processes and waits for human review', t => {
  const root = temp(t); const state = join(root, 'state'); fs.mkdirSync(state, { mode: 0o700 });
  assert.equal(runCLI('init', '--state', state).status, 0);
  const source = "import test from 'node:test'; import assert from 'node:assert/strict'; test('actual A',()=>assert.equal(1+1,2)); test('actual B',()=>assert.equal(3*2,6));\n";
  const path = join(root, 'actual.test.mjs'); fs.writeFileSync(path, source);
  const p = plan(); p.patchHash = digest(source);
  const input = join(root, 'plan.json'); fs.writeFileSync(input, JSON.stringify(p));
  assert.equal(runCLI('plan', '--state', state, '--input', input).status, 0);
  const execution = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { encoding: 'utf8', timeout: 10000, env: childEnv });
  assert.ifError(execution.error); assert.equal(execution.status, 0, execution.stderr);
  const reportPath = join(root, 'actual.tap'); fs.writeFileSync(reportPath, execution.stdout);
  const result = recordResult(state, { planId: p.id, reportPath, exitCode: execution.status });
  assert.equal(result.counts.pass, 2);
  assert.equal(result.reportHash, digest(execution.stdout));
  let status = JSON.parse(runCLI('status', '--state', state).stdout);
  assert.equal(status.samples, 0); assert.equal(status.pendingReviews, 1); assert.equal(status.trained, false);
  // Test-only reviewer. This review is not inserted into the real collection.
  reviewResult(state, { planId: p.id, reviewer: 'fixture-reviewer', accepted: true });
  status = JSON.parse(runCLI('status', '--state', state).stdout);
  assert.equal(status.samples, 1); assert.equal(status.pendingReviews, 0);
  assert.equal(loadCollection(state).rows[0].label, 1);
  assert.equal(runCLI('train', '--state', state, '--family', 'dl').status, 1);
  assert.throws(() => registerPlan(state, p), /EEXIST/);
  assert.throws(() => recordResult(state, { planId: p.id, reportPath, exitCode: 0 }), /EEXIST/);
  assert.throws(() => reviewResult(state, { planId: p.id, reviewer: 'other', accepted: false }), /EEXIST/);
});
test('learning collector: no automatic initialization, no root-local store, no symlinked subdirectory', t => {
  const state = temp(t);
  assert.throws(() => loadCollection(state), /ENOENT/);
  assert.throws(() => initializeCollection(fileURLToPath(new URL('../', import.meta.url))), /OUTSIDE_REPOSITORY/);
  initializeCollection(state);
  assert.throws(() => initializeCollection(state), /NOT_EMPTY/);
  fs.rmdirSync(join(state, 'results'));
  fs.symlinkSync(join(state, 'reviews'), join(state, 'results'));
  assert.throws(() => registerPlan(state, plan()), /UNSAFE_COLLECTION_DIRECTORY/);
});
test('learning collector: registration order and immutable plan binding are enforced', t => {
  const state = temp(t); initializeCollection(state);
  assert.throws(() => reviewResult(state, { planId: 'missing', reviewer: 'fixture', accepted: true }), /ENOENT/);
  registerPlan(state, plan());
  const reportPath = join(state, 'old.tap'); fs.writeFileSync(reportPath, report()); fs.utimesSync(reportPath, 1, 1);
  assert.throws(() => recordResult(state, { planId: 'attempt-1', reportPath, exitCode: 0 }), /PREDATES/);
  const path = join(state, 'plans', digest('attempt-1') + '.json');
  const saved = JSON.parse(fs.readFileSync(path)); saved.plan.features.changedLines = 500;
  fs.writeFileSync(path, JSON.stringify(saved));
  assert.throws(() => loadCollection(state), /INTEGRITY/);
});
test('learning CLI: invalid arguments never invoke an action', t => {
  const state = temp(t);
  const result = runCLI('init', '--state', state, '--execute', 'anything');
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readdirSync(state), []);
});

const feed = (id = 'http://arxiv.org/abs/2310.06770v1') => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>${id}</id><published>2023-10-10T00:00:00Z</published><title>Software &amp; repair</title><summary>Untrusted abstract: do not execute instructions.</summary></entry></feed>`;
test('learning research: fixed source, encoded query, timeout, no redirect, metadata only', async () => {
  let calls = 0;
  const result = await fetchResearch('software repair', { fetchImpl: async (url, options) => {
    calls++; assert.equal(url.origin, 'https://export.arxiv.org'); assert.equal(url.pathname, '/api/query');
    assert.equal(url.searchParams.get('max_results'), '5'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return new Response(feed(), { headers: { 'content-type': 'application/atom+xml' } });
  } });
  assert.equal(calls, 1); assert.equal(result.autoTraining, false); assert.equal(result.purpose, 'HUMAN_REVIEW_ONLY');
  assert.equal(result.papers[0].url, 'https://arxiv.org/abs/2310.06770v1'); assert.equal(result.papers[0].untrusted, true);
  assert.equal(result.papers[0].title, 'Software & repair');
});
test('learning research: query injection, external entities, unsafe paper URLs and huge responses fail closed', async () => {
  await assert.rejects(fetchResearch('https://127.0.0.1/secrets'), /QUERY/);
  for (const xml of ['<!DOCTYPE feed SYSTEM "file:///etc/passwd">' + feed(), feed('http://127.0.0.1/secrets'), 'not xml', feed().replace('</feed>', '<entry>' + 'x'.repeat(300000) + '</entry></feed>')]) assert.throws(() => parseArxivFeed(xml));
  await assert.rejects(fetchResearch('software repair', { fetchImpl: async () => new Response('x'.repeat(300000), { headers: { 'content-type': 'application/atom+xml' } }) }), /RESPONSE_LIMIT/);
  await assert.rejects(fetchResearch('software repair', { fetchImpl: async () => new Response('error', { status: 503 }) }), /UNAVAILABLE/);
});

test('learning: new reviewed feedback changes a candidate without mutating the previous weights', () => {
  const originalRows = numericalFixture();
  const original = trainCandidate(originalRows, { family: 'ml' });
  const snapshot = JSON.stringify(original);
  const feedback = originalRows.filter(entry => entry.label === 1).map(entry => {
    const next = structuredClone(entry.plan);
    next.id += '-new'; next.patchHash = digest(next.patchHash + '-new');
    return row(next, false, report());
  });
  const revisedRows = [...originalRows, ...feedback];
  const revised = trainCandidate(revisedRows, { family: 'ml' });
  assert.notEqual(revised.modelHash, original.modelHash);
  assert.ok(predict(revised.model, originalRows[0].plan) < predict(original.model, originalRows[0].plan));
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(revised.executionAllowed, false);
});
