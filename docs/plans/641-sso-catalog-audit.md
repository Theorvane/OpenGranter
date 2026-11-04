# SSO catalog durable metadata audit

## Issue and problem
Issue #641, parent #637: catalog HTTP requires an injected durable audit append. Existing gateway audit requires a proxy credential; SSO discovery has none.

## Scope and expected behavior
1. Add a separate metadata-only table and validated append adapter. Preserve actual principal/policy attribution or explicit anonymous failures; never synthesize credentials.
2. Await INSERT acknowledgement. Reject malformed events; sanitize failures. Do not store tokens, content or arbitrary properties.
3. Register migration 012 without changing historical SQL; verify replay and populated upgrade.
4. Test ready/list, detail, missing, unavailable, anonymous denial, invalid metadata, storage/clock/ack failures and schema constraints.
5. Run migration/catalog/HTTP regressions, strict types, lint and CI. Backend owns runtime/session mounting separately.

## Design
Dedicated append-only metadata avoids false attribution. Contract: contracts/sso-catalog-audit.md. No public API, permission change, content retention, provider calls or automatic activation. A row is not tamper resistance; operational retention/export and installed PostgreSQL acceptance remain separate gates.

## TDD plan
Public adapter tests first; expected RED: missing module. GREEN: metadata persisted in PGlite, invalid attribution rejected before SQL, fixed failure behavior. Run npm run check where resources permit; separate local from CI and installed evidence.

## Delivery
Independent worktree; exact-head CI and independent formal approval required. Never rewrite applied migration bytes or automatically replay failed reads.
