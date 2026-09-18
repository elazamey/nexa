/**
 * @nexa/learning — observations, patterns, hypotheses, reflection, knowledge, replay and
 * benchmarks.
 *
 * The learning layer is pure: it reads *records*, produces *data*, and cannot change
 * anything. Its output is a proposal, and a proposal is worth exactly as much as the
 * evidence and the measurement behind it.
 */
export {
  OMEGA_OBSERVATION_DOMAIN,
  observationId,
  callObservations,
  observeRun,
  callsOf,
  flattenCalls,
} from './src/observation.js';
export { OMEGA_PATTERN_DOMAIN, patternId, patternKey, minePatterns, isActionable } from './src/pattern.js';
export {
  OMEGA_HYPOTHESIS_DOMAIN,
  PROPOSAL_TARGETS,
  hypothesisId,
  posterior,
  formHypothesis,
  improvementProposal,
} from './src/hypothesis.js';
export { OMEGA_REFLECTION_DOMAIN, reflectionId, reflect } from './src/reflection.js';
export {
  EPISTEMIC_STATES,
  KNOWLEDGE_STATUS,
  OMEGA_KNOWLEDGE_DOMAIN,
  promoteClaim,
  KnowledgeStore,
} from './src/knowledge.js';
export {
  OMEGA_BENCHMARK_DOMAIN,
  BENCHMARK_CATEGORIES,
  defineSuite,
  measureOutcome,
  evaluateSuite,
  assertReproducible,
  compareRuns,
} from './src/benchmark.js';
export {
  OMEGA_REPLAY_DOMAIN,
  planReplay,
  replayDigest,
  diffReplay,
  assertReplay,
  replayOutcome,
} from './src/replay.js';
export { LEARNER_JOURNAL_KINDS, Learner } from './src/learner.js';
