# FieldScan agent development rules

FieldScan is a safety-sensitive field-evidence system. Optimize for demonstrable
correctness, bounded cost, traceability, and useful human review.

## Required workflow

1. Read `docs/DIRECTION.md`, `docs/DECISIONS.md`, `docs/FINDINGS.md`, and
   `docs/EVOLUTION.md` before proposing architectural changes.
2. Start from a task key and explicit success criteria.
3. Prefer deterministic code over an LLM for routing, validation, grading,
   caching, deduplication, and policy enforcement.
4. Give each model only the evidence and tools needed for its current task.
5. Bound retries, context, output, latency, and spend.
6. Keep self-confidence separate from the independent official grade.
7. Never weaken mandatory safety or manager-review gates based on a grade.
8. Add or update tests and record significant findings and rejected options.
9. Never commit `.dev.vars`, `.env*`, credentials, raw customer photos, or
   private job data.

## Acceptance gate

Scores use a 0-10 scale. A candidate is accepted only when it passes all hard
safety checks and reaches the improvement target:

- Baseline <= 6.0: baseline + 4.2
- Baseline > 6.0: baseline + 2.4
- Display both the requested target and the achievable capped target of 10.0

A higher aggregate score never compensates for a failed hard safety check.
