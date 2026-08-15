# Evaluation report — 2026-08-15

Command:

    node scripts/evaluate-variants.mjs --baseline C:\Users\Servi\code\fieldscan-ai --candidate C:\Users\Servi\pain2hustle-profile\fieldscan-ai --run-tests

| Variant | Score | Hard gates | Result |
| --- | ---: | --- | --- |
| Untouched original | 2.04 / 10 | Failed auth and image-bound gates | Baseline only |
| Candidate | 10.00 / 10 | All passed | Accepted |

- Baseline rule: baseline is at or below 6.0, so requested improvement is +4.2.
- Requested target: 6.24 / 10.
- Achievable target: 6.24 / 10.
- Measured delta: +7.96.
- Target met: yes.

This is a deterministic release-conformance score across correctness, security,
evidence, efficiency, recovery, and usability. It is not a claim of perfect
real-world model accuracy. The UI's operational agent grade remains provisional
at 8.2 until at least 20 labeled production scans exist.

## Verification

- Original baseline tests: passed.
- Candidate full suite: passed.
- Runtime suite: 34 assertions, zero model calls.
- Secret scan: 19 files, no secret-like values.
- Agent, UI, Worker-route, metering, and HVAC suites: passed.

## Remaining production work

- Collect labeled field outcomes and calibrate the operational grade.
- Add an actual response cache only after invalidation, privacy, and safety
  policies are approved. The current SHA-256 key is an idempotency receipt, not
  permission to reuse stale safety conclusions.

## Deployment follow-up — 2026-08-15

- D1 database `fieldscan-ai` is bound as `DB`; the remote schema applied.
- Production reports `metering: d1-atomic`.
- Worker version `871cb162-654d-453a-91b4-11582dfc8d37` is live at
  `https://fieldscan-ai.pain2hustle1.workers.dev`.
- Live checks passed for `/health`, the application shell, unauthorized scan
  rejection, and the authenticated 18-key task registry.
