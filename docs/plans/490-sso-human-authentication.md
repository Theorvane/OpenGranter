# Reusable SSO human authentication

## Issue and problem

- Issue [#490](https://github.com/Theorvane/OpenGranter/issues/490).
- The confirmed JWT verifier and exact active-human binding are bundled into issue/revoke. A future HTTP handler needs authentication before body consumption without duplicating verification or invoking management prematurely.

## Scope and expected behavior

- Expose createPostgresSsoHumanAuthenticator({ client, verifyAccessToken }) returning authenticateHuman(accessToken), with a trusted internal verification port and the existing binding reader. Return only the current active human principal ID.
- Validate a nonempty, well-formed, non-NUL token of at most 16384 UTF-16 units before calling the verifier or SQL. Invalid token/rejected verification/missing or non-human binding throws fixed SsoManagementUnauthenticated. Verifier throws, malformed verified identities and binding failures throw fixed SsoManagementAuthenticationUnavailable; no raw claims, token, driver data or causes.
- Capture ports once; each call re-verifies and reads current exact binding state. Existing identity reader captures claim fields and immutable SQL parameters before asynchronous work. No authentication cache, caller actor nomination, email fallback or automatic account creation.
- Reuse this authenticator inside the existing SSO issue/revoke service. Preserve its existing validation-before-authentication order, current IAM, required audit, owner caps, decisions and atomic credential writes. Preserve gateway error exports and constructor identities.
- No new HTTP endpoint, HTTP error/status contract, authentication audit schema/kind, deployment activation, lifetime-error distinction, migration or provider/usage behavior. The contributor is deciding the HTTP contract separately; unanswered choices do not become requirements here.

## Design

- Move the two existing safe authentication error classes to the identity module; re-export them from the old gateway module to retain compatibility. Compose the trusted verification port with createPostgresSsoIdentityBindingReader and sanitize dependency errors independently of thrown domain names.
- A reusable authenticated-principal boundary avoids copying SSO logic into HTTP. It supplies identity only; downstream management still evaluates IAM. Binding state changed after a read is not transactionally revalidated; later calls reload it.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [authenticator contract](../../contracts/sso-human-authentication.md), [composition contract](../../contracts/sso-token-management.md) and [compatibility inventory](../openrouter-compatibility.md). Existing glossary terms apply; no new domain term or costly architectural decision is introduced.

## TDD plan

- Write public boundary tests before production code, then run a deny-only typed authenticator export. Valid runtime-signed JWTs resolving to active humans must fail before implementation; invalid token and dependency classifications must be missing.
- Cover runtime-signed success, missing/inactive/service and exact current binding changes through migrated PostgreSQL; rejection/throws/malformed verifier identities before SQL; fixed privacy-safe errors; failed/malformed binding rows; bounded token/getter/port capture and mutation across awaits.
- Assert authentication SQL never reads policies or writes decisions/credentials/lifecycle/usage; preserve existing gateway constructor exports and all issue/revoke regression cases.
- Implement the smallest shared boundary, refactor the existing service, format and run focused tests plus full npm run check.

## Delivery

- Issue and new branch first, English plan before code, meaningful red/green, published-diff review and sjungwon03-ai exact-head approval plus both CI jobs before sjungwon03 squash merge/main sync.
- Rollback restores the bundled implementation and removes the reusable export; no database migration. Public HTTP/audit/provisioning and full release #116/#7 remain separate.

## Verification evidence

SSO human authentication is now reusable before a future management HTTP body is consumed. createPostgresSsoHumanAuthenticator captures a trusted verifier and query client, validates bounded token input, verifies identity, resolves its current exact pre-registered active-human binding, and returns only the human principal ID. Authentication rejection and dependency failures retain fixed claim-free errors.

The existing SSO issue/revoke service reuses this boundary while preserving operation validation before authentication, current IAM/Deny, required decision audit, owner lifetime caps and atomic credential lifecycle writes. The two authentication error constructors move to the identity module and remain re-exported from the gateway module with identical constructor references. No configuration, migration, dependency, proxy/API/provider/usage or OpenRouter pin changes occur.

Validation:
- Behavioral red: node --experimental-strip-types --test test/sso-human-authentication.test.ts against a deny-only typed export failed 31 of 43 tests for missing valid authentication, dependency classification and verifier/binding work; 12 expected denials/alias checks passed. Missing-module failure was separately observed and is not the behavioral evidence.
- Green: all 43 new boundary tests pass; focused boundary/JWT/management regression suite passes 243 tests. Runtime-generated signed JWTs exercise all migrated PostgreSQL stores and current mapping/kind/active changes. Invalid input/verifier claims, missing/service/inactive/ambiguous/malformed bindings, throws, capture/mutation/privacy and constructor aliases are covered.
- Focused V8 coverage: the new authenticator and refactored SSO management service have 100% line/branch/function coverage. The existing binding reader also reaches 100% in this suite.
- Final npm run check passes 6,436 tests, zero failed, with one existing opt-in real PostgreSQL test skipped locally; strict types, lint, planning/link/contract/secret checks and all three OpenRouter pin-integrity checks pass. Both repository CI jobs additionally gate merge, including real disposable PostgreSQL.
- git diff --check passes; all existing migrations and structural pins remain unchanged. Formatting/import reordering and a restricted test-helper variable-name lint failure were corrected before the final full check.

Limits: this is an internal authentication prerequisite, not a public management HTTP route or authentication-audit contract. The contributor's HTTP contract, anonymous audit surface and public lifetime-error decisions remain unanswered and separate; this issue does not silently select them. Registered issuer auth_time end-user semantics, manual key rebuilds, separate binding/policy reads without transaction revalidation, missing network JWKS/replay/introspection/access-token revocation and audited provisioning remain as previously disclosed. Authentication itself adds no policy lookup, credential/audit/lifecycle/usage mutation or automatic account creation. Full release #116 and unresolved #7 remain open.

