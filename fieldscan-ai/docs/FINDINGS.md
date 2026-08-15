# Findings log

## Baseline inspection — 2026-08-15

- FieldScan was not in a Git repository.
- The pain2hustle repository was clean before import.
- FieldScan was a plain Cloudflare Worker, not a Cloudflare Agents SDK Agent.
- One Gemini/Ollama vision call performed equipment classification, evidence
  completeness, safety review, scoring, and pricing suggestions together.
- Deterministic normalization already enforced important manager-review gates.
- Quota was checked before model spend and recorded after a successful scan.
- Existing tests passed, and the masked publish-payload secret scan passed.
- The metering test printed PASS/FAIL results but did not fail the process with
  assertions when those checks were false.
- Production configuration used `gemini-flash-latest` and a deprecated
  sampling parameter instead of a pinned current model and strict JSON schema.
- `/scan` authentication was fail-open when its secret was absent.
- Request image count, type, and approximate decoded size were not bounded.
- KV usage increment was intentionally non-atomic, so concurrent requests could
  exceed the promised cost boundary.
- Whole model calls could be repeated after invalid JSON, increasing spend
  without a distinct charge or idempotency receipt.

## Security handling

Live-looking credentials appeared in clipboard content during discovery. They
were not copied into this repository. They must be revoked and rotated outside
Git.

## Candidate result — 2026-08-15

- Full candidate suite passes, including 34 runtime-hardening assertions.
- The deterministic release evaluator scores the original 2.04 and candidate
  10.00, a +7.96 delta with every candidate hard gate passing.
- The operational Agent Grade Card stays at a provisional 8.2 because six
  evaluated samples are not enough to claim stable field accuracy.
- D1 supports atomic reservation, but the checked-in Wrangler configuration
  still has only KV. Bind D1 before claiming a strict concurrent cost ceiling.
- The Apiary auto-publish watcher was intentionally left stopped because its
  repository is divergent and contains unrelated founder changes.
