/** Small CPU models for tabular plan scoring, NOT an LLM or general intelligence. */
import { FEATURES, FEATURE_LIMITS, digest, exact, identifier, requireCondition, splitDataset, validateFeatures } from './data.js';

const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, x))));
const finite = value => Number.isFinite(value) && Math.abs(value) <= 100;
function rng(seed = 42) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}
export function createModel(family, strategies) {
  requireCondition(['ml', 'dl'].includes(family), 'UNKNOWN_MODEL_FAMILY');
  requireCondition(Array.isArray(strategies) && strategies.length >= 2 && strategies.length <= 16 && new Set(strategies).size === strategies.length, 'INVALID_STRATEGIES');
  strategies.forEach(identifier);
  const names = [...strategies].sort();
  const dimensions = family === 'ml' ? [FEATURES.length + names.length, 1] : [FEATURES.length + names.length, 12, 6, 1];
  const random = rng();
  const layers = dimensions.slice(1).map((size, i) => ({
    weights: Array.from({ length: size }, () => Array.from({ length: dimensions[i] }, () => (random() * 2 - 1) * Math.sqrt(6 / (dimensions[i] + size)))),
    biases: Array(size).fill(0),
  }));
  return { version: 1, family, features: [...FEATURES], strategies: names, layers };
}
export function validateModel(model) {
  exact(model, ['version', 'family', 'features', 'strategies', 'layers']);
  requireCondition(model.version === 1 && JSON.stringify(model.features) === JSON.stringify(FEATURES), 'MODEL_VERSION_OR_FEATURE_MISMATCH');
  const template = createModel(model.family, model.strategies);
  requireCondition(Array.isArray(model.layers) && model.layers.length === template.layers.length, 'INVALID_ARCHITECTURE');
  for (let l = 0; l < model.layers.length; l++) {
    const layer = model.layers[l]; const expected = template.layers[l];
    exact(layer, ['weights', 'biases']);
    requireCondition(Array.isArray(layer.weights) && layer.weights.length === expected.weights.length
      && Array.isArray(layer.biases) && layer.biases.length === expected.biases.length && layer.biases.every(finite), 'INVALID_WEIGHTS');
    for (const row of layer.weights) requireCondition(Array.isArray(row) && row.length === expected.weights[0].length && row.every(finite), 'INVALID_WEIGHTS');
  }
  requireCondition(JSON.stringify(model.strategies) === JSON.stringify(template.strategies), 'INVALID_STRATEGY_ORDER');
  return model;
}
function vector(model, plan) {
  validateFeatures(plan.features);
  requireCondition(model.strategies.includes(plan.strategy), 'UNSEEN_STRATEGY');
  return [
    ...FEATURES.map(name => 2 * Math.log1p(plan.features[name]) / Math.log1p(FEATURE_LIMITS[name]) - 1),
    ...model.strategies.map(name => Number(plan.strategy === name)),
  ];
}
function forward(model, x) {
  const activations = [x];
  for (let l = 0; l < model.layers.length; l++) {
    const { weights, biases } = model.layers[l];
    const input = activations.at(-1);
    activations.push(weights.map((row, j) => {
      const z = row.reduce((sum, w, i) => sum + w * input[i], biases[j]);
      return l === model.layers.length - 1 ? sigmoid(z) : Math.tanh(z);
    }));
  }
  return activations;
}
const emptyGradient = model => model.layers.map(layer => ({ weights: layer.weights.map(row => row.map(() => 0)), biases: layer.biases.map(() => 0) }));
export const binaryLoss = (p, y) => -y * Math.log(Math.max(1e-12, p)) - (1 - y) * Math.log(Math.max(1e-12, 1 - p));

/** Exposed for finite-difference verification of the actual backpropagation. */
export function lossAndGradient(model, x, label) {
  const a = forward(model, x);
  const p = a.at(-1)[0];
  const gradient = emptyGradient(model);
  let delta = [p - label]; // sigmoid + binary cross entropy
  for (let l = model.layers.length - 1; l >= 0; l--) {
    for (let j = 0; j < delta.length; j++) {
      gradient[l].biases[j] = delta[j];
      for (let i = 0; i < a[l].length; i++) gradient[l].weights[j][i] = delta[j] * a[l][i];
    }
    if (l > 0) delta = a[l].map((activation, i) => model.layers[l].weights.reduce((sum, row, j) => sum + row[i] * delta[j], 0) * (1 - activation * activation));
  }
  return { loss: binaryLoss(p, label), gradient };
}
export function predict(model, plan) {
  validateModel(model);
  return forward(model, vector(model, plan)).at(-1)[0];
}
function evaluate(model, rows, prior) {
  let loss = 0; let baselineLoss = 0; let brier = 0; let correct = 0;
  for (const row of rows) {
    const score = forward(model, vector(model, row.plan)).at(-1)[0];
    loss += binaryLoss(score, row.label);
    baselineLoss += binaryLoss(prior, row.label);
    brier += (score - row.label) ** 2;
    correct += Number(Number(score >= 0.5) === row.label);
  }
  return { samples: rows.length, logLoss: loss / rows.length, baselineLogLoss: baselineLoss / rows.length, brier: brier / rows.length, accuracy: correct / rows.length };
}

export function trainCandidate(rows, { family = 'ml' } = {}) {
  const split = splitDataset(rows); // never manufactures examples to pass this gate
  const model = createModel(family, [...new Set(split.train.map(row => row.plan.strategy))]);
  const initialWeightsHash = digest(model);
  const examples = split.train.map(row => ({ x: vector(model, row.plan), y: row.label }));
  const prior = examples.reduce((sum, row) => sum + row.y, 0) / examples.length;
  let best = structuredClone(model);
  let bestLoss = evaluate(model, split.validation, prior).logLoss;
  let bestEpoch = 0;
  const epochs = 160; const learningRate = 0.15; const l2 = 0.0001;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    const sum = emptyGradient(model);
    for (const row of examples) {
      const { gradient } = lossAndGradient(model, row.x, row.y);
      for (let l = 0; l < sum.length; l++) {
        for (let j = 0; j < sum[l].weights.length; j++) {
          sum[l].biases[j] += gradient[l].biases[j] / examples.length;
          for (let i = 0; i < sum[l].weights[j].length; i++) sum[l].weights[j][i] += gradient[l].weights[j][i] / examples.length;
        }
      }
    }
    for (let l = 0; l < sum.length; l++) {
      for (let j = 0; j < sum[l].weights.length; j++) {
        model.layers[l].biases[j] -= learningRate * Math.max(-5, Math.min(5, sum[l].biases[j]));
        for (let i = 0; i < sum[l].weights[j].length; i++) {
          const gradient = sum[l].weights[j][i] + l2 * model.layers[l].weights[j][i];
          model.layers[l].weights[j][i] -= learningRate * Math.max(-5, Math.min(5, gradient));
        }
      }
    }
    const loss = evaluate(model, split.validation, prior).logLoss;
    if (loss < bestLoss) { best = structuredClone(model); bestLoss = loss; bestEpoch = epoch; }
  }
  validateModel(best);
  return {
    version: 1, status: 'CANDIDATE_ONLY', advisoryOnly: true, executionAllowed: false,
    model: best, modelHash: digest(best), initialWeightsHash, datasetHash: digest(rows),
    training: { samples: split.train.length, epochs, selectedEpoch: bestEpoch, learningRate, l2, split: 'task-group-hash-v1' },
    validation: evaluate(best, split.validation, prior),
    // The test split is consulted once AFTER selecting weights on validation.
    test: evaluate(best, split.test, prior),
    promotion: 'NOT_IMPLEMENTED_REQUIRES_FRESH_EVALUATION_AND_APPROVAL',
  };
}

export function rankPlans(candidate, plans) {
  requireCondition(Array.isArray(plans) && plans.length > 0 && plans.length <= 128, 'INVALID_PLAN_BATCH');
  requireCondition(candidate?.version === 1 && candidate.status === 'CANDIDATE_ONLY' && candidate.modelHash === digest(candidate.model), 'INVALID_CANDIDATE');
  validateModel(candidate.model);
  return {
    advisoryOnly: true, executionAllowed: false, calibrated: false,
    recommendations: plans.map(plan => {
      identifier(plan.id); identifier(plan.strategy); validateFeatures(plan.features);
      const known = candidate.model.strategies.includes(plan.strategy);
      return { id: plan.id, strategy: plan.strategy, score: known ? predict(candidate.model, plan) : null, reason: known ? 'EXPERIMENTAL_MODEL_SCORE' : 'UNSEEN_STRATEGY' };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id)),
  };
}
