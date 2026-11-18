# Canonical SSO operations HTTP composition (#637)

1. Preserve the canonical review handler as read-only. Compose existing bearer-authenticated token issue/revoke with canonical models, usage and audit in a new opt-in factory. No cookie/session, new grants, runtime activation, listener binding, migrations or provider calls.
2. Use the same caller-owned committed SQL connection, issuer/audience/JWKS, clock and request ID source. Keep authentication, fresh IAM, transactional credential decisions and durable access audit inside the existing handlers. Do not accept callback overrides or trust client actor IDs.
3. First run behavior tests against a read-only baseline: read endpoints work but issue returns 404. Then route the exact existing token paths to the existing SSO management handler. Optional public shell wraps the whole application only once; unknown routes remain closed.
4. Verify migrated embedded SQL, locally signed JWTs and real loopback HTTP: models list/detail, usage/audit JSON and CSV, issue/revoke, fresh Deny and identity disable, audit failure and proxy-token-as-SSO rejection. No fixture response adapters for these APIs. This is not installed PostgreSQL, IdP/browser login or deployment acceptance.
5. Run focused regression, full TypeScript, changed-file Biome and repository script checks. Deliver a separate PR with DCO and AI attribution. Merge only after exact-head required CI and independent formal approval. Caller owns TLS, SQL lifetime and trusted browser/session integration.

Contract: contracts/sso-operations-http.md.

## Verification checkpoint
- Read-only baseline: all six behavior cases failed with missing token routes (404), after successful canonical reads in the first case.
- Initial test assumptions corrected to existing contracts: usage exposes authorized credential IDs/upstream model metadata (not bearer secrets), IAM uses active, and mutation error headers do not promise nosniff. No production semantics changed to satisfy those assumptions. Added audit-failure test used the actual sso_usage_audit_events name after correcting its injection selector.
- Final bounded serial seven-file regression: 271 passed, zero failed/skipped. Initial unbounded-heap serial run had four SIGKILL process failures under resource pressure; bounded 256 MB heap completed all cases. This does not claim the aggregate npm check or full suite passed.
- Full TypeScript, changed-file Biome, planning/contracts/secret scan, pinned compatibility and diff checks passed.
- Locally signed JWT, migrated PGlite and bound loopback Node HTTP only; no fixture HTTP responses, no browser/IdP/installed PostgreSQL/provider/deployment success claim.

## Main integration checkpoint (2026-11-18)
1. Merge canonical main 60e9ba66 while retaining both SSO operations and review DOM documentation; do not replace either capability.
2. Preserve the existing bearer-only operations factory and canonical shared projections. No runtime/session/DDL/authority changes.
3. Verify actual loopback HTTP with signed JWT and migrated embedded SQL plus review DOM, canonical identity and browser-closure regressions. Run full typecheck, lint and repository contracts before pushing the original PR branch.
4. Request a fresh independent formal review on the new exact head; old approvals and embedded SQL evidence do not certify installed browser/IdP/PostgreSQL/provider operation.

Integration result: 48/48 related tests passed, zero skips, including new real HTTP browser-review-controller/CSV isolation and fresh disabled-identity invalidation. Full TypeScript, full lint (existing warnings/information), repository scripts and six pinned schemas passed. This is Node loopback/PGlite/signed local JWT evidence, not native browser or installed deployment acceptance.

## Strict-CSP main integration checkpoint (2026-11-18 03:00 KST)
Merge main feea149, preserving the reviewed fixed stylesheet, linked HTML and class-only model descriptions as well as this branch functionality. Resolve append-only planning conflicts by retaining both checkpoints. No new session/runtime/DDL or authority contract. Re-run actual HTTP/SQL or disconnect tests and strict-CSP/browser regressions, then request new exact-head CI and independent formal review. Earlier approvals do not approve the new merge commit. Local installed-PostgreSQL and IdP acceptance remain absent.

Combined-tree regression: 37/37 operations/review/build and 28/28 strict-CSP/catalog plus isolated SQL cases passed, zero skips. Earlier aggregate SIGKILLs remain recorded. Full TypeScript, lint, repository scripts and six pinned schemas passed. Full standard npm check is run separately with CPU affinity limiting runner parallelism; results are not assumed from focused success. No new native-browser or installed-deployment claim.

## Shared transport integration (2026-11-18 03:30 KST)
Merge main 02f6ba983aa2ab99a707f5e6750b37803a3e863c after independently approved PR #933. Preserve both operations documentation and non-blocking disconnect cleanup. Re-run real operations HTTP, disconnect, public CSP and browser build tests on the combined tree. Previous HEAD d378606 full npm check completed 9657 tests: 9656 pass, 0 fail, 1 external PostgreSQL skip; this does not approve the new combined HEAD or installed deployment. No runtime/session/DDL or authority expansion.

Combined operations/socket/browser-build tests: 35/35 PASS, zero skips. Dedicated full TypeScript, full lint, repository scripts and six schema pins PASS. Initial invocation used system Node 18 and was rejected before any test executed; corrected to required Node 22.23.0. Separate full standard check is started before PR update and must be read to completion. No new native-browser or deployment evidence.
