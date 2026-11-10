# Durable SSO usage HTTP composition

## Issue and problem
- Issue: #642 (parent #637).
- The reviewed Fetch adapter requires a callback; no concrete durable SSO usage audit composition exists.

## Scope and expected behavior
- Explicit factory connects signed SSO authentication, fresh IAM, scoped usage SQL and awaited PostgreSQL metadata audit.
- Preserve JSON/CSV contracts and failure statuses. No credentials, query text, model names, usage rows or content in audit metadata.
- Out of scope: sessions, BFF, listeners, runtime mount, retention defaults, deployment and paid calls.

## Design
- Add migration 013 and strict metadata projection analogous to catalog audit; wire the existing handler with no audit callback override.
- Dedicated table preserves SSO attribution without inventing proxy credentials. Existing catalog table has incompatible operation constraints; reusing it would corrupt semantics.
- Keep target principal and self/all mode alongside policy versions, count and outcome. Do not enable content retention or decide operator readers.
- Caller owns trusted configuration, database lifecycle and migrations; no automatic activation.
- Contracts: ../../contracts/sso-usage-history.md; ../PRD.md; ../acceptance.md.

## TDD plan
- Import the missing composition from an actual signed-token/migrated PGlite Fetch test: expected module-not-found RED.
- Cover JSON/CSV, empty, unauthenticated, forbidden, invalid query, fresh Deny, awaited insert, failed insert, forged overrides and migration upgrade.
- Unit tests reject invalid metadata, acknowledgement, time and SQL failures without leaking driver data.
- Run focused tests, full typecheck/lint, scripts/check.py, compatibility check and standard npm run check.

## Delivery
- Plan then failing tests, minimal implementation and independent exact-head review/CI.
- Migration is additive; rollback application without deleting audit history. Apply only through approved operator migration workflow.
- Local embedded SQL is not installed PostgreSQL, browser, IdP or provider E2E.

## Verification evidence
- RED: missing concrete HTTP composition module (`/tmp/og-0000-red.log`).
- GREEN: 44 focused tests, zero failures and skips, including actual signed JWT, migrated PGlite, Fetch and insert-block/failure cases (`/tmp/og-0000-green2.log`).
- Full typecheck, lint (existing 42 warnings/160 infos), planning/contract scan and six offline compatibility pins pass.
- Standard npm run check started separately (`/tmp/og-0000-fullcheck.log`); result must be recorded after completion, not inferred from focused success.

- Standard full-check execution exposed a dependent runtime test with a fixed version-012 history expectation. Its assertion was wrapped as GatewayStartupUnavailable. Updated that assertion to require all 13 versions, preserving its ordering and exact-history check. This is a test expectation update, not a runtime workaround.
- Additional isolated runtime attempts while fullcheck was still active were SIGKILLed (`/tmp/og-0000-runtime.log`, `/tmp/og-0000-runtime-regression.log`); these do not establish regression success. Fullcheck also recorded SIGKILL in other database test files. Do not label this standard fullcheck PASS.
