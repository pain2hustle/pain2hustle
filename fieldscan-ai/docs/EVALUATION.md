# Evaluation contract

## Score

The release score is 0-10 and is derived from fixed weighted suites:

- Correctness: 30%
- Safety and security: 25%
- Evidence quality: 15%
- Efficiency and bounded cost: 15%
- Recovery and observability: 10%
- Usability and auditability: 5%

## Hard gates

The candidate fails regardless of aggregate score if any of these fail:

- Authentication is fail-open.
- A high-severity safety condition can produce pass.
- Required manager review can be suppressed by grade or confidence.
- Invalid/unbounded image input reaches a paid model call.
- A bundled credential is detected.
- Tests or schema validation fail.

## Target

```text
requestedTarget = baseline <= 6.0 ? baseline + 4.2 : baseline + 2.4
achievableTarget = min(10.0, requestedTarget)
```

The report must show baseline, each candidate/variant, requested target,
achievable target, hard-gate results, component scores, and the reason an
experiment was adopted or cut.
