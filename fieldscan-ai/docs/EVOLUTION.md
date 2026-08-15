# Evolution ledger

This file records what is evolving, adopted, cut, or deferred. A feature moves
to ADOPTED only after tests and evaluation demonstrate value.

## EVOLVING

| Capability | Hypothesis | Evidence required |
| --- | --- | --- |
| Intent Compiler | One-line task keys can replace repeated prompts and route work predictably | Routing/validation tests and smaller context |
| Context Makers | Parallel cheap extraction reduces main-model input | Token/input estimate and equal-or-better eval quality |
| Consolidator | One evidence ledger avoids long serial agent chains | Conflict/deduplication tests and fewer repeated facts |
| Gradekeeper | Independent grades reveal improvement and regression | Stable scoring tests, sample thresholds, history deltas |
| Grade Card UI | A simple card makes agent development understandable | Accessible rendering and user-readable weak areas |
| Content-addressed cache | Versioned hashes safely skip duplicate work | Correct invalidation and tenant isolation tests |
| Targeted reread | Repairing only failed evidence costs less than whole-call retries | Failure fixtures and call-count comparison |

## ADOPTED

| Capability | Reason |
| --- | --- |
| pain2hustle Git ownership | One durable project history |
| Deterministic safety normalization | Explicit and testable behavior |
| Meter-before-model ordering | Blocks known over-quota calls before spend |
| Manager review gates | Required for unknown, incomplete, or high-risk evidence |
| Independent grade authority | Prevents agents from grading themselves |
| Secret scan before deploy | Fails closed without printing credentials |
| Intent, context, and consolidation routes | Authenticated, tested planning surface |
| Pinned Gemini structured output | Current GA model and strict JSON contract |
| Bounded inputs and targeted retry | Blocks invalid spend and whole-call retry loops |
| Daily quality and weekly source watch | Continuous evidence without auto-changing production |

## CUT OR DEFERRED

| Capability | State | Reason / revisit condition |
| --- | --- | --- |
| Long serial agent chain | CUT | Repeats context, raises latency, and obscures failures |
| Every helper as an LLM | CUT | Most helper work has deterministic rules |
| Self-issued official grade | CUT | Conflicts with independent evaluation |
| Stale safety-result reuse | CUT | Policy or evidence changes require re-evaluation |
| LangChain/LangGraph Phase 1 | DEFERRED | Duplicates the current Cloudflare runtime needs |
| Tree-sitter in scan runtime | CUT | AST parsing helps the developer/PR agent, not photo review |
| Repository-wide dependency graph in scan runtime | CUT | Developer-only capability |
| MCP before external systems exist | DEFERRED | Add when a real rate book, CRM, manuals, or work-order system is connected |
| Vector-only RAG | CUT | Exact identifiers need lexical retrieval or explicit filters too |
| Unbounded raw-data blast | CUT | Use references, budgets, consolidation, and selective reread |
| Automatic production mutation from research | CUT | Research may recommend; promotion remains reviewed |
