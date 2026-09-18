/**
 * Benchmarks — improvement as a measurement, not an opinion.
 *
 * A suite is a fixed list of tasks with expected outcomes. Running it twice must give
 * the same numbers, or the numbers mean nothing: `assertReproducible()` runs the suite
 * twice and refuses a plan whose own results move. A candidate is only interesting
 * *relative to a baseline*, on the same tasks, with the same expectations — and a task
 * the baseline passed and the candidate fails is a regression, whatever the aggregate
 * says.
 */
import { canonicalBytes } from '../../ast/index.js';
import { sha256Multihash } from '../../crypto/index.js';
import { OmegaError } from '../../compiler/index.js';

export const OMEGA_BENCHMARK_DOMAIN = 'NEXA/omega1 benchmark\u0000';

export const BENCHMARK_CATEGORIES = Object.freeze([
  'coding',
  'filesystem-analysis',
  'mcp',
  'planning',
  'reasoning',
  'memory-retrieval',
  'tool-selection',
  'recovery',
  'security',
]);

const VERDICTS = Object.freeze(['ALLOW', 'DENY']);

/** @param {object} value @returns {string} */
function digest(value) {
  return sha256Multihash(Buffer.concat([
    Buffer.from(OMEGA_BENCHMARK_DOMAIN, 'utf8'),
    canonicalBytes(value),
  ]));
}

/** @param {unknown} value @param {string} field @param {number} fallback */
function count(value, field, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OmegaError('OMEGA_E_BENCHMARK', `${field} must be a non-negative integer`);
  }
  return value;
}

/**
 * @param {{name: string, tasks: object[]}} input
 * @returns {object} a content-addressed suite
 */
export function defineSuite({ name, tasks } = {}) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new OmegaError('OMEGA_E_BENCHMARK', 'a suite needs a name');
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new OmegaError('OMEGA_E_BENCHMARK', 'a suite needs at least one task');
  }
  const seen = new Set();
  const normalised = tasks.map((task, index) => {
    if (typeof task !== 'object' || task === null) throw new OmegaError('OMEGA_E_BENCHMARK', `task ${index} is not an object`);
    if (typeof task.id !== 'string' || task.id.trim().length === 0) throw new OmegaError('OMEGA_E_BENCHMARK', `task ${index} needs an id`);
    if (seen.has(task.id)) throw new OmegaError('OMEGA_E_BENCHMARK', `duplicate task id: ${task.id}`);
    seen.add(task.id);
    if (!BENCHMARK_CATEGORIES.includes(task.category)) {
      throw new OmegaError('OMEGA_E_BENCHMARK', `task ${task.id} has unknown category ${String(task.category)}`, { known: [...BENCHMARK_CATEGORIES] });
    }
    if (typeof task.mission !== 'string' || task.mission.length === 0) {
      throw new OmegaError('OMEGA_E_BENCHMARK', `task ${task.id} needs a mission`);
    }
    const expect = task.expect ?? {};
    const verdict = expect.verdict ?? 'ALLOW';
    if (!VERDICTS.includes(verdict)) throw new OmegaError('OMEGA_E_BENCHMARK', `task ${task.id} expects an unknown verdict`);
    return {
      id: task.id,
      category: task.category,
      module: task.module ?? null,
      mission: task.mission,
      expect: {
        verdict,
        max_steps: count(expect.max_steps, 'max_steps', 64),
        max_cost: count(expect.max_cost, 'max_cost', 1_000),
        max_denials: count(expect.max_denials, 'max_denials', 0),
        evidence_integrity: expect.evidence_integrity ?? true,
      },
    };
  });
  const body = { nexa: 'omega1', kind: 'BenchmarkSuite', name, categories: [...BENCHMARK_CATEGORIES], tasks: normalised };
  return { ...body, id: digest(body) };
}

/**
 * Adapt a mission outcome into the shape a task expects, so a suite can run missions
 * without knowing anything about the machine.
 *
 * @param {object} outcome
 * @param {{latency_ms?: number, cost?: number, evidence_integrity?: boolean}} [measurements]
 * @returns {object}
 */
export function measureOutcome(outcome, { latency_ms = 0, cost = 0, evidence_integrity = true } = {}) {
  const denials = outcome.records.filter((record) => record.kind === 'TOOL_RESULT' && record.decision === 'DENY');
  return {
    verdict: outcome.status,
    steps: outcome.steps,
    tool_calls: outcome.records.filter((record) => record.kind === 'TOOL_CALL').length,
    denials: denials.length,
    cost,
    latency_ms,
    evidence_integrity,
    failures: [...new Set(denials.map((record) => record.detail?.code ?? 'OMEGA_E_UNKNOWN'))].sort(),
  };
}

/**
 * @param {object} input
 * @param {object} input.suite
 * @param {(task: object) => object} input.run a synchronous, deterministic runner
 * @returns {object} a `BenchmarkRun`
 */
export function evaluateSuite({ suite, run } = {}) {
  if (typeof suite !== 'object' || suite === null || suite.kind !== 'BenchmarkSuite') {
    throw new OmegaError('OMEGA_E_BENCHMARK', 'a BenchmarkSuite is required');
  }
  if (typeof run !== 'function') throw new OmegaError('OMEGA_E_BENCHMARK', 'a run function is required');
  const results = [];
  for (const task of suite.tasks) {
    const measured = run(task);
    if (typeof measured !== 'object' || measured === null) {
      throw new OmegaError('OMEGA_E_BENCHMARK', `task ${task.id} produced no result`);
    }
    const verdict = measured.verdict ?? null;
    const failures = [];
    if (verdict !== task.expect.verdict) failures.push('verdict');
    if ((measured.steps ?? 0) > task.expect.max_steps) failures.push('steps');
    if ((measured.cost ?? 0) > task.expect.max_cost) failures.push('cost');
    if ((measured.denials ?? 0) > task.expect.max_denials) failures.push('denials');
    if (task.expect.evidence_integrity && measured.evidence_integrity === false) failures.push('evidence');
    results.push({
      id: task.id,
      category: task.category,
      ok: failures.length === 0,
      verdict,
      steps: measured.steps ?? 0,
      tool_calls: measured.tool_calls ?? 0,
      denials: measured.denials ?? 0,
      cost: measured.cost ?? 0,
      latency_ms: measured.latency_ms ?? 0,
      evidence_integrity: measured.evidence_integrity !== false,
      failures,
    });
  }
  const passed = results.filter((result) => result.ok).length;
  const body = {
    nexa: 'omega1',
    kind: 'BenchmarkRun',
    suite: suite.id,
    suite_name: suite.name,
    tasks: results,
    metrics: {
      tasks: results.length,
      passed,
      failed: results.length - passed,
      success_rate_bp: results.length === 0 ? 0 : Math.round((passed / results.length) * 10_000),
      steps: results.reduce((sum, result) => sum + result.steps, 0),
      tool_calls: results.reduce((sum, result) => sum + result.tool_calls, 0),
      denials: results.reduce((sum, result) => sum + result.denials, 0),
      cost: results.reduce((sum, result) => sum + result.cost, 0),
      latency_ms: results.reduce((sum, result) => sum + result.latency_ms, 0),
      evidence_integrity: results.every((result) => result.evidence_integrity),
    },
  };
  return { ...body, id: digest(body) };
}

/**
 * @param {{suite: object, run: (task: object) => object}} input
 * @param {number} [rounds]
 * @returns {object} the run, having proved that it repeats
 */
export function assertReproducible({ suite, run }, rounds = 2) {
  const first = evaluateSuite({ suite, run });
  for (let round = 1; round < rounds; round += 1) {
    const again = evaluateSuite({ suite, run });
    if (again.id !== first.id) {
      throw new OmegaError('OMEGA_E_BENCHMARK_NONDETERMINISTIC', `the suite produced a different result on round ${round + 1}: a measurement that moves is not a measurement`, {
        first: first.id,
        again: again.id,
      });
    }
  }
  return first;
}

/**
 * @param {object} baseline a `BenchmarkRun`
 * @param {object} candidate a `BenchmarkRun` over the same suite
 * @returns {object} the comparison, with regressions called out by task
 */
export function compareRuns(baseline, candidate) {
  if (baseline?.kind !== 'BenchmarkRun' || candidate?.kind !== 'BenchmarkRun') {
    throw new OmegaError('OMEGA_E_BENCHMARK', 'two BenchmarkRuns are required');
  }
  if (baseline.suite !== candidate.suite) {
    throw new OmegaError('OMEGA_E_BENCHMARK', 'two runs can only be compared on the same suite');
  }
  const byId = new Map(candidate.tasks.map((task) => [task.id, task]));
  const regressions = [];
  const improvements = [];
  for (const before of baseline.tasks) {
    const after = byId.get(before.id);
    if (after === undefined) {
      regressions.push({ id: before.id, reason: 'the candidate did not run this task' });
      continue;
    }
    if (before.ok && !after.ok) regressions.push({ id: before.id, reason: `failed: ${after.failures.join(', ')}` });
    if (!before.ok && after.ok) improvements.push({ id: before.id, reason: 'now passes' });
  }
  const deltas = {
    success_rate_bp: candidate.metrics.success_rate_bp - baseline.metrics.success_rate_bp,
    steps: candidate.metrics.steps - baseline.metrics.steps,
    tool_calls: candidate.metrics.tool_calls - baseline.metrics.tool_calls,
    denials: candidate.metrics.denials - baseline.metrics.denials,
    cost: candidate.metrics.cost - baseline.metrics.cost,
    latency_ms: candidate.metrics.latency_ms - baseline.metrics.latency_ms,
  };
  const ok = regressions.length === 0;
  const body = {
    nexa: 'omega1',
    kind: 'BenchmarkComparison',
    suite: baseline.suite,
    baseline: baseline.id,
    candidate: candidate.id,
    verdict: ok ? 'PASS' : 'FAIL',
    code: ok ? null : 'OMEGA_E_BENCHMARK_REGRESSION',
    improvements,
    regressions,
    deltas,
    metrics: { baseline: baseline.metrics, candidate: candidate.metrics },
  };
  return { ...body, id: digest(body) };
}
