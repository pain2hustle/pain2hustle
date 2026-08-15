# FieldScan deployment receipt

## Production — 2026-08-15

| Item | Result |
| --- | --- |
| Worker | `fieldscan-ai` |
| URL | `https://fieldscan-ai.pain2hustle1.workers.dev` |
| Version | `871cb162-654d-453a-91b4-11582dfc8d37` |
| D1 database | `fieldscan-ai` (`efe8e6de-7380-40de-bbfa-2c6fdb9e4b97`) |
| D1 binding | `DB` |
| Metering | Atomic D1 reservation and refund |
| Provider | Gemini |

## Verification

- Remote D1 schema applied: three statements, `users` and `usage` tables.
- `GET /health`: healthy, Gemini configured, D1 atomic metering active.
- `GET /`: HTTP 200.
- Unauthorized `POST /scan`: HTTP 401.
- Authenticated `GET /tasks`: all 18 versioned task keys returned.
- Full local test suite and Wrangler dry run passed before deploy.

Secrets are stored only as Worker secrets. Their values are intentionally not
recorded in this repository or receipt.
