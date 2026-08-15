# Decision log

## 2026-08-15 — Keep FieldScan in pain2hustle Git

**Decision:** Import FieldScan as `fieldscan-ai/` in the existing
`pain2hustle/pain2hustle` repository without a nested `.git` directory.

**Why:** One history, one review surface, and no ambiguity about repository
ownership. Local secrets and generated Wrangler state remain excluded.

## 2026-08-15 — Deterministic helpers before model helpers

**Decision:** Intent routing, input checks, context shaping, consolidation,
grading, cache selection, and safety gates begin as deterministic modules.

**Why:** These tasks have explicit rules. Model calls would add cost and
variance without adding necessary judgment.

## 2026-08-15 — Independent grades

**Decision:** Agents submit confidence and unknowns, while a separate
Gradekeeper calculates the official grade from measured outcomes.

**Why:** Self-ratings are useful signals but are not reliable evaluation.

## 2026-08-15 — Conditional improvement target

**Decision:** Use a 0-10 score. Require +4.2 when the original score is 6.0 or
below, and +2.4 when it is above 6.0. Scores are capped at 10.0, but reports
must also show an uncapped requested target. Hard safety checks are mandatory.

## 2026-08-15 — Defer LangChain/LangGraph

**Decision:** Do not add LangChain or LangGraph in Phase 1.

**Why:** Cloudflare Workers/Agents/Workflows cover the required runtime shape,
and the current pipeline is small. Reconsider only if portable cross-runtime
graphs, checkpoint tooling, or graph visualization becomes a measured need.

## 2026-08-15 — Scheduled evidence, reviewed evolution

**Decision:** Run deterministic tests and secret checks daily. Watch first-party
AI documentation weekly and save an artifact, but never auto-modify or deploy
production from research output.

**Why:** Regressions deserve fast detection; frontier changes need judgment.
