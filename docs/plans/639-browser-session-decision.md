# R1 browser session decision proposal (#639)

Parent #637. Status: PROPOSED; not an approved security contract, implementation permission, deployment approval or acceptance result. No runtime, schema or default changes accompany this document.

## Why the existing shell cannot sign in

The public entry mounts a signed-out shell. Existing registered-key RFC9068 access-token verification is a server API capability, not OIDC login. A caller-supplied UI request port is not an authenticated browser session. Static assets, company identity bindings and discovery permission cannot confer administration rights. See [R0 ordering](../product-traceability.md#ordered-contracts), [human authentication](../../contracts/sso-human-authentication.md) and [SSO tokens](../../contracts/sso-access-tokens.md). Source-only follow-up factories/branches must be reviewed on their exact revisions before adoption; their existence is not evidence of merge or activation.

## Proposed first vertical slice

Choose a same-origin server-side OIDC Authorization Code + PKCE BFF. Keep access/refresh/ID tokens and client secrets off the browser. The BFF must obtain an access token accepted by the existing registered issuer/audience/key verifier; an ID token, unsigned identity header or browser-provided principal cannot substitute. Company binding and fresh persisted IAM remain authoritative on every protected request. First acceptance is login -> current principal -> authorized model list/detail -> logout/expiry/denial. No management-write UI activation, refresh implementation, bootstrap administrator, provider invocation or new permission is included in this slice.

### Proposed HTTP boundary (all names subject to review)

| Route | Proposed behavior |
| --- | --- |
| GET /management/auth/login | Fixed issuer/client/redirect; one-use short-lived state, nonce and PKCE transaction; no client-selected issuer or arbitrary return URL. Login initiation must be bound to this browser. |
| GET /management/auth/callback | Validate transaction binding/state before a bounded server token exchange; verify OIDC nonce/issuer/audience and required token claims; reject replay. Never render or log the code/tokens/provider error body. Rotate session identifier after authentication. |
| GET /management/auth/session | Cookie-authenticated, no-store projection of current principal and bounded expiry plus a session-bound CSRF token; never bearer tokens/claims. An expired/inactive/unbound identity returns 401 with no protected projection. This read does not grant model or administrative permission. |
| POST /management/auth/logout | Validate exact Origin and session-bound CSRF token, invalidate server session and clear cookie. Do not use GET logout or assume a company-wide IdP logout. |
| Existing exact GET /management/v1/me and model list/detail routes | Resolve opaque session server-side and delegate through the existing fresh bearer-authenticated API boundary with mandatory durable audit. Never trust a request Authorization header as the browser session or accept both authorities ambiguously. No public Bearer API is silently converted: use a separately reviewed opt-in composition. |

Every auth/private response is no-store and nosniff. OIDC callback transport details and public error mapping need explicit review; do not expose raw diagnostics. Return destinations are fixed/allowlisted same-origin paths, not arbitrary query values. Unknown paths/methods fail closed rather than entering an SPA fallback. Do not add permissive CORS, token query parameters, localStorage/sessionStorage tokens or a window-global grant API.

### Session and ingress proposal

- Use a high-entropy opaque identifier in a host-only __Host- cookie: Secure, HttpOnly, Path=/, SameSite=Lax, no Domain. Require reviewed HTTPS ingress, including the browser acceptance target; do not silently disable Secure for local testing. A future non-HTTPS development adapter requires its own explicit contract and cannot certify deployment.
- Keep server-side token/session records separate from public UI state; store only an identifier digest in lookups. Select and review storage, encryption/key lifecycle, atomic transaction consumption and revocation before implementing persistence/DDL. Never persist raw token material in logs, audit or browser build artifacts.
- Bound session lifetime by the verified access-token expiry and an explicitly approved maximum. No automatic renewal/refresh or idle-lifetime extension in the first slice. Restart behavior must fail closed unless reviewed durable session storage provides safe recovery.
- Pin the external origin and redirect URI in trusted configuration. Reject unknown Host/Origin; trust forwarded headers only from explicitly configured ingress peers. Do not derive issuer, redirect URI or cookie policy from request-controlled forwarding headers.
- Cross-origin unsafe requests fail closed. Before activating any credential/write bridge, require exact Origin and session-bound synchronizer CSRF checks, existing method/content-type/body limits, current IAM and mandatory transactional audit. SameSite is defense-in-depth, not the CSRF contract.
- Failure of session resolution/authentication/audit never yields protected data. Logout, expiry, 401/403 and principal change clear protected UI synchronously and invalidate pending completions. pagehide/pageshow cannot restore a previous grant. Model visibility still requires existing invocation/provider permissions, not blanket iam:Manage.

## Decisions required before session code

No row is approved merely by merging this proposal. Record the approving owner and exact reviewed artifact/revision for each row.

| Decision | Requested owner | Required approval/evidence | Current state |
| --- | --- | --- | --- |
| Architecture and first-slice authority boundary | User + architect | Choose BFF or explicit alternative; reviewed HTTP/security contract | Pending |
| Company IdP registration | Operator + backend | Exact issuer, audience, client type/auth method, registered redirect URI, accepted token/key policy, authorized test identity | Pending; never supply secrets in this document |
| Origin and ingress | Infrastructure + architect | External HTTPS origin, TLS termination, trusted proxy peers/header policy, callback reachability | Pending |
| Session/transaction lifecycle | Backend + architect | Storage/encryption, replay consumption, revocation/restart semantics, expiry maximum, concurrent request rules | Pending |
| CSRF and cookie/error contract | Backend + security reviewer | Exact cookie attributes, Origin/CSRF validation, login binding, denial/audit availability behavior | Pending |
| Integration dependency revisions | Frontend + backend + coordinator | Exact reviewed shell/API/workspace HEADs and owned files; no inference of branch approval | Pending |
| Browser/deployment acceptance | User + infrastructure | Approved target/configuration/test identity; separate explicit paid budget only if live provider acceptance is requested later | Pending |

## Numbered implementation plan after contract approval

1. Record the approved decision artifact, exact dependency HEADs, file ownership and configuration schema. Frontend owns entry/workspace/login DOM; backend owns OIDC/session/CSRF and storage; coordinator owns agreed composition/integration tests. Do not edit another owners files without explicit transfer.
2. Write contract-derived RED tests: unauthenticated shell, login binding, callback state/nonce/PKCE/replay, invalid signature/issuer/audience, expired/inactive binding, cookie/Origin/CSRF, redirect/header spoofing, unavailable storage/audit and token-redaction. Assert no protected database/API read on denied requests.
3. Implement the smallest explicitly opted-in server boundary and storage lifecycle, then GREEN those tests. Preserve existing bearer APIs/default runtime and avoid new roles or schema promotion without review.
4. Connect the existing public shell through its reviewed private transport contract. Run real Node HTTP + database tests, then native HTTPS browser login/current-principal/model list/detail/logout; exercise loading, empty, unavailable, expiry, Deny, back/forward and late-response suppression. Signed local IdP/test tokens and PGlite are labeled local, not company IdP or installed PostgreSQL evidence.
5. Open a scoped implementation PR; obtain valid formal approval and all required CI success on its exact final HEAD before merge. Read-only review is not formal approval. Install only after separate target/configuration approval; preserve rollback and record exact artifact/revision/URL evidence.

## Current evidence and remaining gates

This proposal has no code RED/GREEN, browser login, session URL, company IdP, installed PostgreSQL, deployment or live-provider result. Documentation validation is not feature progress or closure of #639/#637. The full original PRD, administrator CRUD, routing/limits, review/export, installed E2E/recovery and operator handoff remain open. The next deliverable is an approved concrete security contract, then the executable first vertical slice above, not another disconnected fixture component.
