# Management catalog transport (#639, parent #637)

## 1. Scope
Connect management presentation to existing authorized model list and exact detail APIs. This transport component does not implement browser login, a session-to-proxy-token bridge, administrator catalog CRUD or provider calls. R1 browser authority remains a separate integration gate. See docs/PRD.md and contracts/openai-model-retrieval.md.

## 2. Contract
The injected request adapter owns already-authorized requests. GET /api/v1/models consumes a data array; GET /api/v1/models/{encodedId} consumes the bare exact model. Respect reserved count/user collection precedence and bounded exact alias syntax. Always request no-store and reject redirects. Project only id/object/created/owned_by; never expose error bodies, credentials or arbitrary metadata. No token acquisition, storage, persistence or implicit credential delegation.

One client represents one active list/detail view. A new read supersedes the old one. The caller MUST invoke invalidate() on session/identity changes and disposal. Abort and suppress stale results, including while parsing a body, even if the transport ignores abort. The UI owns loading state; empty ready arrays are distinct from errors. Ready discovery does not certify administrator permissions.

## 3. Acceptance and implementation
First add tests for paths/envelopes, empty list, reserved/malformed identifiers, sanitized error states, safe projection, network failures, invalidation and overlapping reads. Then implement the small typed transport. Add real Node HTTP handler tests on managed/delegated catalog routes verifying fresh IAM and no inference, secrets, limits or usage invocation. Keep authentication fixture provenance explicit.

## 4. Local evidence (2026-11-04)
Node 18 cannot run the repository strip-types runner; use the installed Node 22.23.4 ARM64. Baseline with the new test and absent source failed ERR_MODULE_NOT_FOUND. Implementation passed 8 unit tests. Typecheck then identified Node RequestInit cache typing and ES2024 isWellFormed incompatibility; fixed with a narrow request-init intersection and guarded encodeURIComponent, without changing global compiler target. Biome identified control-character regex policy; replaced it with explicit character-code checks.

Final focused run: 11 passed, 0 failed, 0 skipped, including 2 actual localhost HTTP socket tests against the production Node request server/handler with fixture identity/catalog and 1 body-parsing invalidation test. Log: /tmp/og-1011-catalog-focused.log. This is NOT real browser login, installed deployment, production IAM/SSO or live provider evidence. Full typecheck/lint/check and exact-HEAD CI/review results must be recorded separately before merge.

## 5. Integration and release
Frontend owns UI/session wiring; this module owns only catalog transport. Pass a reviewed authorized adapter, wire loading/empty/error rendering, and invalidate on identity/session teardown. Browser authority must not be invented here. Require exact-HEAD full required CI and independent formal approval before merging. Do not close #639 or #637 based on this component.
