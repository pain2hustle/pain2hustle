import { ContractError, assertPlainObject, assertStringArray, validateAgentResult } from "./contracts.mjs";

function stableValue(value) {
  return `${typeof value}:${String(value)}`;
}

function allowsMultipleValues(key) {
  return key.startsWith("asset.") || key === "evidence.present";
}

export function consolidateAgentResults(input) {
  const value = assertPlainObject(input, "input");
  const allowed = new Set(["results", "requiredEvidence"]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new ContractError(`unexpected key(s): ${unexpected.join(", ")}`, "input");
  if (!Array.isArray(value.results) || !value.results.length || value.results.length > 50) {
    throw new ContractError("must be an array containing 1 to 50 results", "input.results");
  }
  const results = value.results.map((entry, index) => validateAgentResult(entry, `input.results[${index}]`));
  const requiredEvidence = assertStringArray(value.requiredEvidence ?? [], "input.requiredEvidence", { maxItems: 100 })
    .map((entry) => entry.toLowerCase());

  const evidenceRefs = new Set();
  const unknowns = new Set();
  const factGroups = new Map();
  let confidenceTotal = 0;
  for (const result of results) {
    result.evidenceRefs.forEach((ref) => evidenceRefs.add(ref));
    result.unknowns.forEach((unknown) => unknowns.add(unknown));
    confidenceTotal += result.confidence;
    for (const fact of result.facts) {
      const groupKey = fact.key;
      if (!factGroups.has(groupKey)) factGroups.set(groupKey, new Map());
      const variants = factGroups.get(groupKey);
      const valueKey = stableValue(fact.value);
      if (!variants.has(valueKey)) variants.set(valueKey, { ...fact, sources: new Set(), evidenceRefs: new Set() });
      const accumulated = variants.get(valueKey);
      accumulated.sources.add(fact.source);
      fact.evidenceRefs.forEach((ref) => accumulated.evidenceRefs.add(ref));
    }
  }

  const facts = [];
  const conflicts = [];
  for (const [key, variants] of factGroups.entries()) {
    const normalized = [...variants.values()].map((fact) => ({
      key: fact.key,
      value: fact.value,
      sources: [...fact.sources].sort(),
      evidenceRefs: [...fact.evidenceRefs].sort(),
    }));
    facts.push(...normalized);
    if (normalized.length > 1 && !allowsMultipleValues(key)) conflicts.push({ key, variants: normalized });
  }
  facts.sort((left, right) => left.key.localeCompare(right.key) || stableValue(left.value).localeCompare(stableValue(right.value)));
  conflicts.sort((left, right) => left.key.localeCompare(right.key));

  const presentEvidence = new Set(
    facts
      .filter((fact) => fact.key === "evidence.present" && typeof fact.value === "string" && !fact.value.startsWith("missing:"))
      .map((fact) => fact.value.toLowerCase()),
  );
  const missingEvidence = [...new Set(requiredEvidence.filter((required) => !presentEvidence.has(required)))].sort();
  const blocked = results.some((result) => result.status === "blocked");
  const status = blocked ? "blocked" : conflicts.length || missingEvidence.length || unknowns.size ? "needs_more" : "complete";

  return {
    facts,
    evidenceRefs: [...evidenceRefs].sort(),
    unknowns: [...unknowns].sort(),
    conflicts,
    missingEvidence,
    confidence: Number((confidenceTotal / results.length).toFixed(4)),
    status,
    ledger: {
      resultCount: results.length,
      factCount: facts.length,
      conflictCount: conflicts.length,
      missingEvidenceCount: missingEvidence.length,
      sourceAgents: results.map((result) => result.agentId).sort(),
    },
  };
}
