import {
  ContractError,
  assertAllowedKeys,
  assertFiniteNumber,
  assertPlainObject,
  assertString,
  assertStringArray,
  validateTaskRequest,
} from "./contracts.mjs";

function result(agentId, facts, evidenceRefs, unknowns) {
  const uniqueRefs = [...new Set(evidenceRefs)];
  const uniqueUnknowns = [...new Set(unknowns)];
  return {
    agentId,
    facts,
    evidenceRefs: uniqueRefs,
    unknowns: uniqueUnknowns,
    confidence: uniqueUnknowns.length ? 0.5 : 1,
    status: uniqueUnknowns.length ? "needs_more" : "complete",
  };
}

export function makeSubmissionContext(input) {
  const value = assertPlainObject(input, "submission");
  assertAllowedKeys(value, ["inputRefs", "assets"], "submission");
  const inputRefs = assertStringArray(value.inputRefs ?? [], "submission.inputRefs", { maxItems: 50 });
  if (!Array.isArray(value.assets) || value.assets.length > 50) throw new ContractError("must be an array of at most 50 assets", "submission.assets");
  const facts = [];
  const evidenceRefs = [];
  const unknowns = [];
  for (const [index, raw] of value.assets.entries()) {
    const path = `submission.assets[${index}]`;
    const asset = assertPlainObject(raw, path);
    assertAllowedKeys(asset, ["ref", "sha256", "mimeType", "width", "height"], path);
    const ref = assertString(asset.ref, `${path}.ref`);
    const sha256 = assertString(asset.sha256, `${path}.sha256`, { pattern: /^[a-f0-9]{64}$/i, max: 64 }).toLowerCase();
    const mimeType = assertString(asset.mimeType, `${path}.mimeType`, { pattern: /^image\/(jpeg|png|webp)$/i, max: 20 }).toLowerCase();
    const width = assertFiniteNumber(asset.width, `${path}.width`, { min: 1, max: 100_000 });
    const height = assertFiniteNumber(asset.height, `${path}.height`, { min: 1, max: 100_000 });
    if (!Number.isInteger(width) || !Number.isInteger(height)) throw new ContractError("dimensions must be integers", path);
    evidenceRefs.push(ref);
    facts.push({ key: "asset.sha256", value: sha256, source: "submission", evidenceRefs: [ref] });
    facts.push({ key: "asset.mime_type", value: mimeType, source: "submission", evidenceRefs: [ref] });
    facts.push({ key: "asset.pixel_count", value: width * height, source: "submission", evidenceRefs: [ref] });
    if (!inputRefs.includes(ref)) unknowns.push(`asset ${ref} is not declared in inputRefs`);
  }
  for (const ref of inputRefs) if (!evidenceRefs.includes(ref)) unknowns.push(`inputRef ${ref} has no asset metadata`);
  if (!value.assets.length) unknowns.push("no image assets supplied");
  return result("submission_context", facts, evidenceRefs, unknowns);
}

export function makeEvidenceContext(input) {
  const value = assertPlainObject(input, "evidence");
  assertAllowedKeys(value, ["observations"], "evidence");
  if (!Array.isArray(value.observations) || value.observations.length > 100) {
    throw new ContractError("must be an array of at most 100 observations", "evidence.observations");
  }
  const facts = [];
  const evidenceRefs = [];
  const unknowns = [];
  for (const [index, raw] of value.observations.entries()) {
    const path = `evidence.observations[${index}]`;
    const observation = assertPlainObject(raw, path);
    assertAllowedKeys(observation, ["requirement", "evidenceRef", "present"], path);
    const requirement = assertString(observation.requirement, `${path}.requirement`, { max: 200 }).toLowerCase();
    const evidenceRef = assertString(observation.evidenceRef, `${path}.evidenceRef`);
    if (typeof observation.present !== "boolean") throw new ContractError("must be a boolean", `${path}.present`);
    evidenceRefs.push(evidenceRef);
    facts.push({
      key: "evidence.present",
      value: observation.present ? requirement : `missing:${requirement}`,
      source: "evidence_observation",
      evidenceRefs: [evidenceRef],
    });
    if (!observation.present) unknowns.push(requirement);
  }
  return result("evidence_context", facts, evidenceRefs, unknowns);
}

export function makePolicyContext(request) {
  const validated = validateTaskRequest(request);
  const facts = [
    { key: "policy.version", value: validated.policyVersion, source: "request", evidenceRefs: [] },
    { key: "task.key", value: validated.taskKey, source: "request", evidenceRefs: [] },
  ];
  return result("policy_context", facts, [], []);
}

export function runContextMakers({ request, assets = [], observations = [] }) {
  const validated = validateTaskRequest(request);
  return [
    makeSubmissionContext({ inputRefs: validated.inputRefs, assets }),
    makeEvidenceContext({ observations }),
    makePolicyContext(validated),
  ];
}
