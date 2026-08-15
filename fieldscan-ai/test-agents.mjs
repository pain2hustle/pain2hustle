import assert from "node:assert/strict";
import { ContractError, validateAgentResult, validateTaskRequest } from "./src/agents/contracts.mjs";
import { compileIntent, listTaskKeys, TASK_REGISTRY } from "./src/agents/intent.mjs";
import { makeEvidenceContext, makeSubmissionContext, runContextMakers } from "./src/agents/context.mjs";
import { consolidateAgentResults } from "./src/agents/consolidator.mjs";
import { gradeAgent } from "./src/agents/grading.mjs";

const request = {
  taskKey: "hvac.inspect.after.high-risk.v1",
  inputRefs: ["photo-1"],
  policyVersion: "hvac-2026.08",
  budget: { maxTokens: 0, maxCostUsd: 0, deadlineMs: 500 },
};

assert.equal(listTaskKeys().length, 18, "registry contains 2 trades x 3 phases x 3 risks");
assert.ok(TASK_REGISTRY["garage-doors.inspect.before.low-risk.v1"]);
const intent = compileIntent(request);
assert.deepEqual(intent.intent, { trade: "hvac", action: "inspect", phase: "after", risk: "high" });
assert.equal(intent.gates.managerApproval, true);
assert.equal(intent.gates.verification, "independent");
assert.ok(intent.requiredEvidence.includes("electrical connections"));
assert.ok(Object.isFrozen(intent) && Object.isFrozen(intent.gates));
assert.throws(() => compileIntent({ ...request, taskKey: "hvac.inspect.after.extreme-risk.v1" }), ContractError);
assert.throws(() => validateTaskRequest({ ...request, surprise: true }), /unexpected key/);
assert.throws(() => validateTaskRequest({ ...request, budget: { maxTokens: -1 } }), /between/);

const hash = "a".repeat(64);
const submission = makeSubmissionContext({
  inputRefs: ["photo-1"],
  assets: [{ ref: "photo-1", sha256: hash, mimeType: "image/jpeg", width: 800, height: 600 }],
});
assert.equal(submission.status, "complete");
assert.equal(submission.facts.find((fact) => fact.key === "asset.pixel_count").value, 480000);
assert.throws(
  () => makeSubmissionContext({ inputRefs: ["bad"], assets: [{ ref: "bad", sha256: "nope", mimeType: "image/jpeg", width: 1, height: 1 }] }),
  /invalid format/,
);

const allObserved = intent.requiredEvidence.map((requirement, index) => ({
  requirement,
  evidenceRef: `photo-${index + 1}`,
  present: true,
}));
const evidence = makeEvidenceContext({ observations: allObserved });
const contexts = runContextMakers({
  request,
  assets: [{ ref: "photo-1", sha256: hash, mimeType: "image/jpeg", width: 800, height: 600 }],
  observations: allObserved,
});
assert.equal(contexts.length, 3);
contexts.forEach((result) => assert.doesNotThrow(() => validateAgentResult(result)));

const consolidated = consolidateAgentResults({ results: [submission, evidence], requiredEvidence: intent.requiredEvidence });
assert.equal(consolidated.status, "complete");
assert.deepEqual(consolidated.missingEvidence, []);
assert.equal(consolidated.ledger.resultCount, 2);

const duplicate = {
  agentId: "checker_one",
  facts: [{ key: "equipment.family", value: "heat-pump", source: "a", evidenceRefs: ["photo-1"] }],
  evidenceRefs: ["photo-1"],
  unknowns: [],
  confidence: 0.9,
  status: "complete",
};
const agreement = {
  ...duplicate,
  agentId: "checker_two",
  facts: [{ ...duplicate.facts[0], source: "b" }],
};
const deduped = consolidateAgentResults({ results: [duplicate, agreement], requiredEvidence: [] });
assert.equal(deduped.facts.length, 1);
assert.deepEqual(deduped.facts[0].sources, ["a", "b"]);
assert.equal(deduped.conflicts.length, 0);

const disagreement = {
  ...agreement,
  facts: [{ key: "equipment.family", value: "furnace", source: "b", evidenceRefs: ["photo-1"] }],
};
const conflicted = consolidateAgentResults({ results: [duplicate, disagreement], requiredEvidence: ["site overview"] });
assert.equal(conflicted.status, "needs_more");
assert.equal(conflicted.conflicts[0].key, "equipment.family");
assert.deepEqual(conflicted.missingEvidence, ["site overview"]);

function sample(id, day, score, selfAssessment = score) {
  return {
    id,
    timestamp: `2026-08-${String(day).padStart(2, "0")}T00:00:00Z`,
    accuracy: score,
    safety: score,
    evidence: score,
    cost: score,
    latency: score,
    recovery: score,
    humanOverride: score,
    selfAssessment,
  };
}

const improvingSamples = [
  ...Array.from({ length: 5 }, (_, index) => sample(`base-${index}`, index + 1, 80, 100)),
  ...Array.from({ length: 5 }, (_, index) => sample(`new-${index}`, index + 6, 85, 0)),
];
const grade = gradeAgent({ agentId: "hvac_inspector", samples: improvingSamples, minimumSamples: 10, windowSize: 5 });
assert.equal(grade.baseline.score, 80);
assert.equal(grade.current.score, 85);
assert.equal(grade.delta, 5);
assert.equal(grade.grade, "B");
assert.equal(grade.trend, "improving");
assert.equal(grade.selfAssessment, 50);
assert.equal(grade.selfAssessmentIsOfficial, false);

const sameObjectiveDifferentSelf = gradeAgent({
  agentId: "hvac_inspector",
  samples: improvingSamples.map((entry) => ({ ...entry, selfAssessment: entry.selfAssessment === 100 ? 0 : 100 })),
  minimumSamples: 10,
  windowSize: 5,
});
assert.equal(sameObjectiveDifferentSelf.current.score, grade.current.score, "self-assessment cannot change official score");
assert.equal(sameObjectiveDifferentSelf.grade, grade.grade, "self-assessment cannot change official grade");

const provisional = gradeAgent({ agentId: "new_agent", samples: [sample("only", 1, 99)], minimumSamples: 5, windowSize: 1 });
assert.equal(provisional.provisional, true);
assert.equal(provisional.rawGrade, "A");
assert.equal(provisional.grade, "C", "small samples cannot claim A");

const weakSafety = gradeAgent({
  agentId: "unsafe_agent",
  samples: [{ ...sample("unsafe", 1, 90), safety: 40 }],
  minimumSamples: 1,
  windowSize: 1,
});
assert.equal(weakSafety.improvementQueue[0].dimension, "safety");
assert.equal(weakSafety.improvementQueue[0].priority, "critical");
assert.throws(() => gradeAgent({ agentId: "bad", samples: [sample("x", 1, 101)] }), /between/);

console.log("agent architecture tests passed");
