const RESULT_STATUSES = new Set(["complete", "needs_more", "blocked"]);
const TASK_KEY_PATTERN = /^(hvac|garage-doors)\.inspect\.(before|during|after)\.(low|standard|high)-risk\.v1$/;

export class ContractError extends TypeError {
  constructor(message, path = "value") {
    super(`${path}: ${message}`);
    this.name = "ContractError";
    this.path = path;
  }
}

export function assertPlainObject(value, path = "value") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractError("must be a plain object", path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ContractError("must be a plain object", path);
  }
  return value;
}

export function assertString(value, path, { pattern, max = 500, allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new ContractError("must be a string", path);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new ContractError("must not be empty", path);
  if (normalized.length > max) throw new ContractError(`must be at most ${max} characters`, path);
  if (pattern && !pattern.test(normalized)) throw new ContractError("has an invalid format", path);
  return normalized;
}

export function assertFiniteNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractError("must be a finite number", path);
  }
  if (value < min || value > max) {
    throw new ContractError(`must be between ${min} and ${max}`, path);
  }
  return value;
}

export function assertAllowedKeys(value, allowed, path = "value") {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new ContractError(`unexpected key(s): ${unexpected.join(", ")}`, path);
}

export function assertStringArray(value, path, { maxItems = 100 } = {}) {
  if (!Array.isArray(value)) throw new ContractError("must be an array", path);
  if (value.length > maxItems) throw new ContractError(`must contain at most ${maxItems} items`, path);
  return value.map((entry, index) => assertString(entry, `${path}[${index}]`));
}

export function validateTaskKey(taskKey) {
  return assertString(taskKey, "taskKey", { pattern: TASK_KEY_PATTERN, max: 80 });
}

export function validateTaskRequest(value) {
  const input = assertPlainObject(value, "request");
  assertAllowedKeys(input, ["taskKey", "inputRefs", "policyVersion", "budget"], "request");
  const taskKey = validateTaskKey(input.taskKey);
  const inputRefs = assertStringArray(input.inputRefs ?? [], "request.inputRefs", { maxItems: 50 });
  const policyVersion = assertString(input.policyVersion, "request.policyVersion", {
    pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/,
    max: 64,
  });
  const budgetInput = input.budget ?? {};
  assertPlainObject(budgetInput, "request.budget");
  assertAllowedKeys(budgetInput, ["maxTokens", "maxCostUsd", "deadlineMs"], "request.budget");
  const budget = {};
  if (budgetInput.maxTokens !== undefined) {
    if (!Number.isInteger(budgetInput.maxTokens)) throw new ContractError("must be an integer", "request.budget.maxTokens");
    budget.maxTokens = assertFiniteNumber(budgetInput.maxTokens, "request.budget.maxTokens", { min: 0, max: 1_000_000 });
  }
  if (budgetInput.maxCostUsd !== undefined) {
    budget.maxCostUsd = assertFiniteNumber(budgetInput.maxCostUsd, "request.budget.maxCostUsd", { min: 0, max: 10_000 });
  }
  if (budgetInput.deadlineMs !== undefined) {
    if (!Number.isInteger(budgetInput.deadlineMs)) throw new ContractError("must be an integer", "request.budget.deadlineMs");
    budget.deadlineMs = assertFiniteNumber(budgetInput.deadlineMs, "request.budget.deadlineMs", { min: 1, max: 86_400_000 });
  }
  return { taskKey, inputRefs: [...new Set(inputRefs)], policyVersion, budget };
}

function validateFact(value, path) {
  const fact = assertPlainObject(value, path);
  assertAllowedKeys(fact, ["key", "value", "source", "evidenceRefs"], path);
  const key = assertString(fact.key, `${path}.key`, { pattern: /^[a-z][a-z0-9_.-]{0,79}$/i, max: 80 });
  const source = assertString(fact.source, `${path}.source`, { max: 100 });
  const evidenceRefs = assertStringArray(fact.evidenceRefs ?? [], `${path}.evidenceRefs`, { maxItems: 25 });
  const primitive = fact.value;
  if (!["string", "number", "boolean"].includes(typeof primitive) || (typeof primitive === "number" && !Number.isFinite(primitive))) {
    throw new ContractError("must be a string, finite number, or boolean", `${path}.value`);
  }
  return { key, value: primitive, source, evidenceRefs: [...new Set(evidenceRefs)] };
}

export function validateAgentResult(value, path = "result") {
  const result = assertPlainObject(value, path);
  assertAllowedKeys(result, ["agentId", "facts", "evidenceRefs", "unknowns", "confidence", "status"], path);
  const agentId = assertString(result.agentId, `${path}.agentId`, { pattern: /^[a-z][a-z0-9_-]{1,63}$/i, max: 64 });
  if (!Array.isArray(result.facts) || result.facts.length > 200) throw new ContractError("must be an array of at most 200 facts", `${path}.facts`);
  const facts = result.facts.map((fact, index) => validateFact(fact, `${path}.facts[${index}]`));
  const evidenceRefs = assertStringArray(result.evidenceRefs ?? [], `${path}.evidenceRefs`, { maxItems: 100 });
  const unknowns = assertStringArray(result.unknowns ?? [], `${path}.unknowns`, { maxItems: 100 });
  const confidence = assertFiniteNumber(result.confidence, `${path}.confidence`, { min: 0, max: 1 });
  const status = assertString(result.status, `${path}.status`, { max: 20 });
  if (!RESULT_STATUSES.has(status)) throw new ContractError("must be complete, needs_more, or blocked", `${path}.status`);
  return {
    agentId,
    facts,
    evidenceRefs: [...new Set(evidenceRefs)],
    unknowns: [...new Set(unknowns)],
    confidence,
    status,
  };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
