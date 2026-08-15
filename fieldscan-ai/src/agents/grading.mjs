import {
  ContractError,
  assertAllowedKeys,
  assertFiniteNumber,
  assertPlainObject,
  assertString,
} from "./contracts.mjs";

export const GRADE_DIMENSIONS = Object.freeze([
  "accuracy",
  "safety",
  "evidence",
  "cost",
  "latency",
  "recovery",
  "humanOverride",
]);

export const DEFAULT_WEIGHTS = Object.freeze({
  accuracy: 0.24,
  safety: 0.24,
  evidence: 0.16,
  cost: 0.1,
  latency: 0.08,
  recovery: 0.1,
  humanOverride: 0.08,
});

const GRADE_ORDER = ["A", "B", "C", "D", "F"];

function scoreToGrade(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function validateWeights(input = DEFAULT_WEIGHTS) {
  const weights = assertPlainObject(input, "weights");
  assertAllowedKeys(weights, GRADE_DIMENSIONS, "weights");
  const normalized = {};
  let total = 0;
  for (const dimension of GRADE_DIMENSIONS) {
    normalized[dimension] = assertFiniteNumber(weights[dimension], `weights.${dimension}`, { min: 0, max: 1 });
    total += normalized[dimension];
  }
  if (Math.abs(total - 1) > 0.000001) throw new ContractError("must sum to 1", "weights");
  return normalized;
}

function validateSample(value, index) {
  const path = `samples[${index}]`;
  const sample = assertPlainObject(value, path);
  assertAllowedKeys(sample, ["id", "timestamp", ...GRADE_DIMENSIONS, "selfAssessment"], path);
  const result = {
    id: assertString(sample.id, `${path}.id`, { max: 100 }),
    timestamp: assertString(sample.timestamp, `${path}.timestamp`, { max: 40 }),
  };
  if (!Number.isFinite(Date.parse(result.timestamp))) throw new ContractError("must be an ISO-compatible timestamp", `${path}.timestamp`);
  for (const dimension of GRADE_DIMENSIONS) {
    result[dimension] = assertFiniteNumber(sample[dimension], `${path}.${dimension}`, { min: 0, max: 100 });
  }
  if (sample.selfAssessment !== undefined) {
    result.selfAssessment = assertFiniteNumber(sample.selfAssessment, `${path}.selfAssessment`, { min: 0, max: 100 });
  }
  return result;
}

function summarize(samples, weights) {
  const dimensions = {};
  for (const dimension of GRADE_DIMENSIONS) {
    dimensions[dimension] = Number((samples.reduce((sum, sample) => sum + sample[dimension], 0) / samples.length).toFixed(2));
  }
  const score = Number(GRADE_DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension] * weights[dimension], 0).toFixed(2));
  return { score, dimensions };
}

function capGrade(grade, maximum) {
  return GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(grade), GRADE_ORDER.indexOf(maximum))];
}

export function gradeAgent(input) {
  const value = assertPlainObject(input, "grading");
  assertAllowedKeys(value, ["agentId", "samples", "minimumSamples", "windowSize", "weights", "targetScore"], "grading");
  const agentId = assertString(value.agentId, "grading.agentId", { pattern: /^[a-z][a-z0-9_-]{1,63}$/i, max: 64 });
  if (!Array.isArray(value.samples) || !value.samples.length || value.samples.length > 10_000) {
    throw new ContractError("must contain 1 to 10,000 samples", "grading.samples");
  }
  const samples = value.samples.map(validateSample).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const ids = new Set(samples.map((sample) => sample.id));
  if (ids.size !== samples.length) throw new ContractError("sample ids must be unique", "grading.samples");
  const minimumSamples = value.minimumSamples ?? 20;
  const windowSize = value.windowSize ?? Math.min(20, samples.length);
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > 10_000) throw new ContractError("must be an integer from 1 to 10,000", "grading.minimumSamples");
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > samples.length) throw new ContractError("must be an integer within sample count", "grading.windowSize");
  const targetScore = value.targetScore ?? 85;
  assertFiniteNumber(targetScore, "grading.targetScore", { min: 1, max: 100 });
  const weights = validateWeights(value.weights ?? DEFAULT_WEIGHTS);
  const baseline = summarize(samples.slice(0, windowSize), weights);
  const current = summarize(samples.slice(-windowSize), weights);
  const delta = Number((current.score - baseline.score).toFixed(2));
  const provisional = samples.length < minimumSamples;
  const rawGrade = scoreToGrade(current.score);
  const grade = provisional ? capGrade(rawGrade, "C") : rawGrade;
  const selfAssessments = samples.filter((sample) => sample.selfAssessment !== undefined).map((sample) => sample.selfAssessment);
  const selfAssessment = selfAssessments.length
    ? Number((selfAssessments.reduce((sum, score) => sum + score, 0) / selfAssessments.length).toFixed(2))
    : null;
  const improvementQueue = GRADE_DIMENSIONS
    .filter((dimension) => current.dimensions[dimension] < targetScore || current.dimensions[dimension] < baseline.dimensions[dimension])
    .map((dimension) => ({
      dimension,
      current: current.dimensions[dimension],
      baseline: baseline.dimensions[dimension],
      gap: Number((targetScore - current.dimensions[dimension]).toFixed(2)),
      priority: dimension === "safety" ? "critical" : current.dimensions[dimension] < 70 ? "high" : "normal",
    }))
    .sort((left, right) => {
      const rank = { critical: 0, high: 1, normal: 2 };
      return rank[left.priority] - rank[right.priority] || right.gap - left.gap;
    });

  return {
    agentId,
    sampleCount: samples.length,
    minimumSamples,
    provisional,
    grade,
    rawGrade,
    baseline,
    current,
    delta,
    trend: delta > 0.5 ? "improving" : delta < -0.5 ? "declining" : "stable",
    selfAssessment,
    selfAssessmentIsOfficial: false,
    improvementQueue,
  };
}
