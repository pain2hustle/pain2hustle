# FieldScan direction

## Approved direction — 2026-08-15

Build a lean, auditable agent system around the existing FieldScan vision
pipeline. Keep it in the `pain2hustle` Git repository.

The execution shape is:

1. Compile one-line intent into a versioned task key and execution contract.
2. Run cheap deterministic context makers in parallel.
3. Consolidate facts, evidence, conflicts, and unknowns once.
4. Send only unresolved evidence to the main vision/reasoning model.
5. Verify the result against deterministic safety and completeness gates.
6. Reread only the evidence that failed or conflicted.
7. Pause high-risk decisions for a human manager.
8. Grade agents independently using eval and production evidence.

## Near-term order

1. Secure and version the existing baseline.
2. Add intent, context, consolidation, grading, and the Agent Grade Card.
3. Add idempotency, atomic cost enforcement, evidence/cache keys, and audit
   receipts.
4. Build representative offline eval fixtures before adding more model agents.
5. Add retrieval only when approved manuals, SOPs, rate books, or service
   records exist to retrieve.

## Product rule

An agent may report uncertainty and ask for targeted help. It may not award its
own official grade, bypass required evidence, or waive a safety gate.
