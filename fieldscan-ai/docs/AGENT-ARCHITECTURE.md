# FieldScan agent architecture

This package defines a deterministic, low-token agent pipeline. It does not call a model, execute tools, or change the existing scan path. The modules are intentionally usable as a sidecar until integration is approved.

## Flow

```text
task request
  -> Intent Compiler / Direction Keeper
  -> deterministic Context Makers
  -> Consolidator and evidence ledger
  -> existing inspector (future integration)
  -> independent Gradekeeper
```

The Direction Keeper converts one stable task key into a frozen plan. The registry contains all combinations of:

- Trade: `hvac`, `garage-doors`
- Phase: `before`, `during`, `after`
- Risk: `low-risk`, `standard-risk`, `high-risk`
- Contract version: `v1`

Example: `hvac.inspect.after.high-risk.v1`.

Plans carry required evidence, context makers, skip and reread rules, approval gates, retry limits, the policy version, input references, and optional budget ceilings. The compiler rejects unknown fields and unregistered keys instead of guessing.

## Contracts

A task request has only four top-level fields:

```json
{
  "taskKey": "hvac.inspect.after.high-risk.v1",
  "inputRefs": ["r2:tenant/job/photo-1"],
  "policyVersion": "hvac-2026.08",
  "budget": { "maxTokens": 0, "maxCostUsd": 0, "deadlineMs": 1000 }
}
```

Every helper emits the same compact result:

```json
{
  "agentId": "evidence_context",
  "facts": [{ "key": "evidence.present", "value": "site overview", "source": "evidence_observation", "evidenceRefs": ["photo-1"] }],
  "evidenceRefs": ["photo-1"],
  "unknowns": [],
  "confidence": 1,
  "status": "complete"
}
```

Facts accept primitive values only. This keeps records comparable, cacheable, and cheap to serialize. Large data remains behind evidence references.

## Context makers

`submission_context` checks image metadata and content hashes without decoding images. `evidence_context` records explicit present/missing observations without trying to infer them. `policy_context` pins the task and policy version. Their results can run independently and contain only facts, evidence pointers, and unknowns.

## Consolidator

The Consolidator validates every helper result, deduplicates identical facts, records sources, detects incompatible values, calculates missing required evidence, and emits an evidence ledger. It returns `needs_more` when a conflict, unknown, or evidence gap exists, and propagates `blocked` from any helper. Downstream work should reread only the listed conflicts and gaps.

## Gradekeeper and Agent Card data

The Gradekeeper is independent of the agent being graded. Each evaluation sample supplies objective 0–100 measurements for:

- Accuracy
- Safety
- Evidence quality
- Cost efficiency
- Latency
- Recovery
- Human-override performance (100 means no unnecessary/corrective override)

The weighted score becomes an A–F grade. The default weighting deliberately gives accuracy and safety the highest influence. A self-assessment may be stored, but it never changes the score or grade.

Grades are provisional until the configured minimum sample count is met. Provisional grades are capped at C, preventing a few easy runs from producing an A. The card data includes first-window baseline, latest-window score, delta, trend, dimensional scores, sample count, and a prioritized improvement queue. Safety weaknesses always receive critical priority.

## Promotion rule

An agent version should be promoted only when it beats the prior version on a representative locked evaluation set and does not regress safety. The product goal of `+4.2` is measured as an objective score delta, not self-confidence. Keep test fixtures, weights, minimum sample count, and policy version fixed during an A/B comparison.

## Future integration boundary

When integration is approved, the existing inspector can consume the frozen intent and consolidated ledger. High-risk tasks require independent verification and manager approval. No grade may disable a required safety or approval gate.
