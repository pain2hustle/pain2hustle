import { ContractError, deepFreeze, validateTaskRequest } from "./contracts.mjs";

const PHASE_EVIDENCE = {
  before: ["site overview", "equipment identity", "pre-work condition"],
  during: ["work area overview", "in-progress condition", "safety controls"],
  after: ["completed work overview", "equipment identity", "final condition"],
};

const TRADE_EVIDENCE = {
  hvac: ["electrical connections", "refrigerant or fuel connections", "drainage and airflow path"],
  "garage-doors": ["springs and cables", "tracks and rollers", "safety reverse controls"],
};

const RISK_POLICY = {
  low: { verification: "rules", managerApproval: false, retryLimit: 1 },
  standard: { verification: "targeted", managerApproval: false, retryLimit: 1 },
  high: { verification: "independent", managerApproval: true, retryLimit: 2 },
};

function makeDefinition(trade, phase, risk) {
  const taskKey = `${trade}.inspect.${phase}.${risk}-risk.v1`;
  return deepFreeze({
    taskKey,
    trade,
    action: "inspect",
    phase,
    risk,
    requiredEvidence: [...PHASE_EVIDENCE[phase], ...TRADE_EVIDENCE[trade]],
    contextMakers: ["submission_context", "evidence_context", "policy_context"],
    skipRules: ["skip model work when deterministic evidence is sufficient", "skip duplicate content hashes"],
    rereadRules: ["reread only conflicting or missing evidence", "never infer hidden conditions"],
    gates: {
      managerApproval: RISK_POLICY[risk].managerApproval,
      verification: RISK_POLICY[risk].verification,
      blockOnMissingEvidence: true,
    },
    retryLimit: RISK_POLICY[risk].retryLimit,
  });
}

const definitions = [];
for (const trade of Object.keys(TRADE_EVIDENCE)) {
  for (const phase of Object.keys(PHASE_EVIDENCE)) {
    for (const risk of Object.keys(RISK_POLICY)) definitions.push(makeDefinition(trade, phase, risk));
  }
}

export const TASK_REGISTRY = deepFreeze(Object.fromEntries(definitions.map((definition) => [definition.taskKey, definition])));

export function listTaskKeys() {
  return Object.keys(TASK_REGISTRY);
}

export function getTaskDefinition(taskKey) {
  const definition = TASK_REGISTRY[taskKey];
  if (!definition) throw new ContractError("is not registered", "taskKey");
  return definition;
}

export function compileIntent(request) {
  const validated = validateTaskRequest(request);
  const definition = getTaskDefinition(validated.taskKey);
  return deepFreeze({
    ...validated,
    intent: {
      trade: definition.trade,
      action: definition.action,
      phase: definition.phase,
      risk: definition.risk,
    },
    requiredEvidence: [...definition.requiredEvidence],
    contextMakers: [...definition.contextMakers],
    skipRules: [...definition.skipRules],
    rereadRules: [...definition.rereadRules],
    gates: { ...definition.gates },
    retryLimit: definition.retryLimit,
  });
}
