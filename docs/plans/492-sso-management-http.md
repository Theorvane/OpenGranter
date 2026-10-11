# Public SSO proxy-token management HTTP API

## Issue and problem

- Issue: #492.
- Existing local-key RFC 9068 verification, current active-human bindings and current IAM token management are internal boundaries. Administrators need the confirmed public issuance/revocation contract without supplying an actor ID.
- Lifetime validation currently shares the unavailable error with database/clock failures, so HTTP cannot return the agreed 400 for an authorized invalid expiry.

## Scope and expected behavior

- POST /management/v1/proxy-tokens accepts {principalId, expiresAt} and returns 201 {credentialId, token}; POST /management/v1/proxy-tokens/revoke accepts {credentialId} and returns 200 {revoked}.
- Authenticate the SSO Bearer before reading or validating the body. Derive the actor only from the current pre-registered active human. Reuse current IAM/Deny, required decision audit and atomic credential lifecycle audit.
- All responses are no-store. Recognized-operation errors use fixed 400/401/403/503 responses. Unknown paths/methods use the existing fixed 404 contract. Anonymous authentication denials/failures must be recorded before responding; failed recording returns 503.
- Authorized past/equal-now or over-cap expiry uses a safe typed lifetime error, mapped to 400. Dependency/clock/invalid cap failures remain unavailable. Unknown revocations are denied; already-revoked credentials require current owner-scoped IAM before revoked:false.
- Separate injected/configured Fetch and unbound Node factories. No automatic runtime activation, provider calls, usage work, authentication cache, retries, issuance deduplication, binding provisioning or new database migration.

## Design

- Snapshot trusted ports; configured composition reuses the local-key RFC 9068 verifier, reusable human authenticator, actor service and gateway audit store. Verify and bind once per request, then bounded JSON parsing and current policy evaluation.
- Accept exact own request fields only, bounded well-formed IDs and nonnegative safe-integer epoch-millisecond expiry. Bound bodies to 16 KiB including streamed bytes; use fatal UTF-8 decoding and application/json. Server-generated ASCII request IDs correlate responses/audits and never imply idempotency.
- Add management-auth-denied/management-auth-unavailable gateway events projecting only operation with anonymous identity fields. Never serialize raw tokens, issuer, subject, body or dependency errors.
- Preserve only the typed lifetime error from the trusted issuance port, reconstructing a safe error; spoofed names remain unavailable. Validate cap/clock before distinguishing caller lifetime errors, after IAM decision persistence.
- Reuse the Node bridge with an optional safe fallback response factory so management adapter failures also use 503/no-store; existing proxy defaults remain unchanged.
- Alternatives: repeating SSO authentication after parsing would duplicate JWT/binding reads; reusing anonymous proxy auth kinds would lose management operation context. Neither is selected.
- Open decisions/dependencies: owned runtime activation, trusted issuer deployment, audited binding provisioning, key refresh and replay/introspection remain follow-up work. The user confirmed the public routes, response semantics, auth audit and lifetime distinction; no selected contract depends on further answers.
- Contracts: [sso-management-http](../../contracts/sso-management-http.md), [proxy-token-lifetimes](../../contracts/proxy-token-lifetimes.md), [token-management](../../contracts/token-management.md); update PRD, architecture, acceptance and compatibility notes.

## TDD plan

- First regression: current actor service must return a distinct fixed lifetime error for allowed expired/over-cap requests, with no credential mutation and persisted Allow decision. Existing behavior is unavailable (expected red).
- First HTTP tests import the absent public factories (expected red), then cover authentication before body reads, exact responses, rejection/audit precedence, body limits/UTF-8/shape, server IDs, cancellation, safe dependency failures and port capture.
- Integration: runtime-signed RFC 9068 tokens, migrated PGlite, human/service caps, fresh binding/policy changes, unknown/already-revoked credentials, decision/lifecycle audit rollback and private anonymous event projection. Real Node sockets cover Fetch parity and adapter fallback; no private signing material is persisted.
- Smallest implementation: typed lifetime distinction, anonymous audit projection, bounded handler, configured composition and optional Node fallback. Refactor only with these boundaries green.
- Run focused node test commands, formatting/type checks, full npm run check and both exact-head CI jobs including real PostgreSQL.

## Delivery

- Record red/green output and check results; commit with authorized contributor identity, DCO and Codex disclosure; open PR linked to this plan, review its exact published diff, obtain sjungwon03-ai approval and merge as sjungwon03 after CI.
- Risks: separate binding/policy reads do not transactionally revalidate concurrent changes. A disconnected/failed response after issuance can leave a valid token whose secret was not received; request IDs do not deduplicate and callers must not automatically retry. Factories do not activate deployment routing. The configured issuer must attest actual human auth_time.
- Rollback: remove the unactivated factories or restore the previous code; existing schemas, credentials, proxy API and compatibility pins remain intact.

## Review correction

The exact-head review identified consumed/locked Fetch bodies as input failures that incorrectly escaped reader acquisition and returned 503. Public-boundary regressions reproduce both cases after authentication (120 pass, 2 expected failures). Catch acquisition failure safely and return the same invalid-body 400, without consuming a reader owned elsewhere or dispatching IAM/mutation. Re-run handler coverage and the full check, update the PR head and obtain fresh exact-head approval/CI after this correction.

## Verification evidence

Administrators now have separate SSO-authenticated Fetch and unbound Node factories for POST /management/v1/proxy-tokens (201 credentialId/token) and POST /management/v1/proxy-tokens/revoke (200 revoked). A configured factory verifies the selected local-key RFC 9068 access token and current pre-registered active-human binding before consuming the body, derives the actor internally and reuses current IAM/Deny, owner-kind caps, required decision audit and atomic credential lifecycle audit.

Authentication denials and outages append management-specific anonymous gateway metadata containing only server request ID, timestamp and issue/revoke operation; required append failure returns 503. Every response, including Node adapter fallback, uses no-store and fixed safe errors. After IAM Allow/audit, past/equal-now or over human30/service90-day expiry now throws a fresh safe typed lifetime error mapped to 400; dependency/clock/mutation failures remain 503. Unknown revoke denies; an already-revoked credential still requires current owner IAM before revoked:false.

The parser accepts exact own fields, bounded well-formed IDs, safe-integer epoch-millisecond expiry, application/json and at most 16 KiB of fatal-decoded streamed UTF-8. It rejects actor/cap/request-ID overrides and queries after authentication, stops on pre-dispatch cancellation and projects only expected success fields. The generic Node bridge gains an optional fallback responder; both proxy error formats retain their previous default 500 behavior. No migrations, dependencies, provider/API, usage/limits or source-pin changes occur.

Validation:
- Behavioral red: lifetime boundary tests initially failed 6 expected-expiry cases because the previous service returned TokenManagementUnavailable; 12 existing success/denial/dependency checks passed. Gateway audit tests initially failed 4 management anonymous append cases because the old projector rejected their kinds; 8 existing/invalid-event checks passed. The initial public HTTP/configured tests separately failed on the absent module/factories (scaffold evidence, not behavioral regression evidence).
- Green: the extended focused coordinator/audit/SSO/socket regression suite passed 277 tests before the additional boundary cases; final management HTTP/configuration/default-proxy socket tests pass 160 cases. Tests include runtime-generated signed JWTs, migrated PGlite stores, exact caps, fresh bindings/activity/kinds/current IAM, denial and required audit precedence, lifecycle rollback, safe SQL/clock failures, streamed size/UTF-8/cancellation cleanup, trusted-port capture, body forgery and private error projection. The final injected handler suite has 122 passing cases.
- New HTTP handler and configured composition reach 100% line/branch/function coverage. Body parsing retains the decoded result until reader cleanup completes; tests remain green through this refactor. The guarded PostgreSQL coordinator also reaches 100% in the focused regression suite.
- Final npm run check passes 6,612 tests, zero failed, with one existing opt-in real PostgreSQL test skipped locally; strict types, lint, planning/link/contract/secret checks and all three OpenRouter schema-pin integrity checks pass. Both exact-head repository check jobs additionally gate merge, including real disposable PostgreSQL.
- Review correction: consumed/locked-body regressions now pass (122 handler tests, 100% line/branch/function coverage). Both cases return 400 after authentication without taking another reader or dispatching management.
- git diff --check passes. Documentation updates cover the selected HTTP contract, lifetime error change and prior pending foundation status. Temporary test-fixture table naming, helper defaults and TypeScript/formatting failures were corrected before final validation.

Limits: factories do not activate existing owned proxy runtimes. Deployment must provide trusted issuer/audience/keys, pre-registered human bindings, migrations, request IDs, TLS/routing/listening and DB lifetime. Binding, policy and owner reads are not transactionally revalidated. Lost issuance responses can leave valid unseen tokens; request IDs only correlate, with no automatic retries/deduplication. Required auth_time relies on trusted issuer semantics; audited binding provisioning, network JWKS/replay/introspection/access-token revocation, full release #116 and unresolved #7 remain open.

