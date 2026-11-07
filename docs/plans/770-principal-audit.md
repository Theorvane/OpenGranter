# Persist current-principal authentication audit

## Issue and problem

Issue: #770, parent #637 / #639, depends on #768 / #769. The current-principal API requires a durable callback but offers no concrete PostgreSQL persistence adapter.

## Scope and expected behavior

1. Add an explicit PostgreSQL auditClient configuration alternative to the existing callback; capture the configured client and clock, reject both modes together or neither.
2. Await an acknowledged dedicated identity-only INSERT before returning identity, 401, or authentication-unavailable. Persistence failure returns audit_unavailable with no identity.
3. Persist only server request ID, timestamp, outcome and authenticated principal ID for ready; failures have NULL identity. Never store tokens, issuer/subject, cookies, claims, proxy credentials, policy grants, or bodies.
4. Propose an explicit opt-in SQL migration, not session DDL. Do not register it in the default migration source set or enable a runtime listener. Applying it requires the database owner/security review. The factory fails closed if the table is absent.
5. No session/BFF/CSRF/CORS/IdP contract, authorization grant, provider request, production deployment or paid call.

## Design

1. Preserve the callback API for existing caller-owned stores; alternatively capture auditClient and use the configured now clock with the dedicated store.
2. Project and validate once before awaiting the database; use parameterized INSERT and require one valid bigint acknowledgement. SQL/clock failures expose a fixed error, never their causes.
3. Dedicated sso_current_principal_audit_events avoids mislabeling identity reads as catalog reads or inventing proxy attribution. No IAM foreign key: deactivation/deletion cannot erase historical facts. Retention, reader authorization and installation remain owner decisions.
4. This branch depends on unmerged PR769 and must not merge independently of that exact API contract and formal review. Contract: [principal audit](../../contracts/current-principal-audit.md); [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md).

## TDD plan

1. First exercise the existing public PostgreSQL factory with a locally signed RFC9068 JWT, migrated active human, real local SQL table and auditClient mode; expect HTTP200 plus a persisted ready row. Existing factory rejects configuration (meaningful RED, not missing import).
2. Cover rejected JWT, inactive binding, unavailable identity, absent audit table, SQL failure/ack corruption, pending INSERT, callback ambiguity, mutation and private extra fields. Verify durable PGlite close/reopen and actual Node HTTP separately from installed PostgreSQL/native browser.
3. Implement the smallest store and opt-in factory composition. No default migration registration or runtime mount.
4. Run targeted tests, strict typecheck, Biome, document/contract checks, compatibility checks and npm run check. Report resource-killed local workers separately from CI.

## Delivery

1. Record RED/GREEN, commit signed-off with assistance disclosure, open draft PR and request exact-head review/CI.
2. No merge without required CI and valid formal approval; no schema installation until separately authorized. Rollback is removal of opt-in factory configuration; preserve audit records.
3. Remaining session, installed PostgreSQL, UI and live-provider acceptance are not certified by local SQL evidence.

## Execution evidence

- RED: existing public PostgreSQL factory rejects auditClient-only configuration with InvalidSsoAccessTokenConfiguration (0 PASS / 1 FAIL), after successful migrated local human/SQL setup. Log: /tmp/og-1830-audit-red.log. No missing-module/import/compiler failure.
- GREEN: local concrete store, public factory, actual Node HTTP, file-backed SQL close/reopen, existing principal boundary, catalog audit and migration suites: 88 PASS / 0 FAIL / 0 SKIP. Log: /tmp/og-1830-audit-focused.log.
- Typecheck passed after correcting a test-only events dynamic-import type mismatch. Lint has no errors (42 warnings / 155 infos); document/link/contract/fixture-secret checks and all six pinned compatibility checks passed. Standard npm run check was launched separately; final outcome is reported in the PR rather than inferred from focused tests.
- Proposed optional DDL is not in the 12-source default manifest; tests prove default migration loading stays unchanged. No installed DB migration, native browser, real IdP, production or paid-call evidence.

- Early uncommitted integration found an EISDIR failure because legacy provider tests read every migrations directory entry. Moved the proposed non-installed DDL to contracts/sql/current-principal-audit.sql instead of adding a migrations subdirectory. Regression: postgres-google-functions 2 PASS / 0 FAIL after location correction. An overlapping exploratory run also had one policy-simulator worker SIGKILL; it is not whole-suite acceptance.

- Final corrected-tree validation: seven focused suites, explicitly serial, 90 PASS / 0 FAIL / 0 SKIP (/tmp/og-1830-audit-verified-green.log). Includes the prior provider-directory regression, local file-backed persistence, actual Node HTTP and unchanged default migration manifest. Concurrent exploratory repeats under the running standard suite had worker SIGKILL and are not passing evidence.
- The initial standard fullcheck overlapped pre-correction files, reported readiness/EISDIR/resource failures, and was stopped by terminating only its verified own process tree. A fresh committed-tree standard check is launched separately, with no concurrent SQL tests. Do not represent either unfinished or interrupted fullchecks as PASS.
