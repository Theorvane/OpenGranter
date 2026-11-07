# Same-origin administration composition (#637 / #640)

## Issue and problem
- Parent #637, identity administration #640. The public workspace contains confirmed credential operations, but the existing review browser server intentionally rejects writes. Prior mutation acceptance uses a separate token-only server and stubs catalog reads.

## Scope and expected behavior
- Add a separately named, explicit opt-in, unbound administration browser handler/server. Compose the existing read-only review API and existing exact POST issue/revoke boundaries behind the public static shell.
- Preserve the existing read-only composer unchanged. No default runtime wiring, binding, schema promotion, new endpoint, permission, session, CSRF/CORS decision, bearer injection or provider call.
- The caller owns SQL lifecycle, approved schemas, artifact, TLS/ingress and any separately approved trusted authority adapter. Current signed SSO, fresh IAM and mandatory audit apply at each existing boundary.

## Design
1. Capture the shared configuration once; instantiate existing read-only and credential handlers.
2. Dispatch only exact POST /management/v1/proxy-tokens and /management/v1/proxy-tokens/revoke to credential management. Delegate all other requests to the unchanged read-only boundary.
3. Reuse public static handler and Node adapter with fixed no-store failure response. Never add endpoint aliases or method overrides.
- Alternative: expanding the read-only composer would violate its safety contract, so use a separate explicit factory.
- Contracts: contracts/sso-administration-browser.md; PRD, architecture and acceptance composition sections.

## TDD plan
1. RED source/built public workspace through missing administration factory, without stubbed HTTP/catalog responses.
2. GREEN actual same-origin Models/Account/confirmed issue/revoke, signed test JWT, migrated PGlite, current IAM Deny and required audit rollback. No raw secrets in audit.
3. Verify public asset isolation, cookie-only rejection, exact route/method allowlist, unchanged read-only server and fixed Node adapter failures.
4. Focused checks, typecheck/lint/scripts/compatibility, whole check and independent exact-head formal approval/CI before merge.

## Delivery
- Separate stacked PR after #762. All ancestor gates remain required.
- Rollback: remove opt-in composer; no schema/data/runtime activation occurs.
- Local PGlite and generated SSO are not installed PostgreSQL, company IdP, native-browser or paid-provider evidence. Browser session contract remains unresolved.
