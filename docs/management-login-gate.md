# Administrator login delivery gate (#637, #639)

Status: **unapproved decision packet**, not an authentication design approval. Source checkpoint: `7feac18d71c8f44567dd45e96797e41e1ed57e49`, inspected 2026-11-09 06:30 KST. Parent [requirement matrix](product-traceability.md#candidate-implementation-checkpoint--2026-11-09-0630-kst).

## Concrete blocking gap

The public entry mounts a sign-in shell with no browser authority acquisition. Existing Account, Models, Usage, Audit and Tokens mounts accept explicit trusted grants only. Supplying a test grant proves a component/API boundary, not a user login. The operator JWKS loader authenticates API bearers but does not implement browser redirects, sessions, token exchange or server logout. Adding more optional factory layers cannot close this gap.

The page browser and desktop observation both returned “This Team Computer screen is still being released” during this checkpoint. No browser processes were modified. A working native browser is an additional acceptance dependency, not a reason to weaken authentication or prevent approved source development.

## Accountable roles to confirm

Proposed decision owner: architecture. Proposed server/session implementer: backend. Proposed page/login/navigation implementer: frontend. Coordinator: LLM specialist. These are requested assignments, **not confirmed ownership or approval**. Record an accountable person, approved artifact and exact implementation HEAD when accepted.

## Required decision record before session production code

| Boundary | Required explicit answer / evidence |
| --- | --- |
| Browser authority mechanism | Choose reviewed same-origin server session/BFF or deliberately designed OIDC browser client; specify credentials and trust transitions. Neither is selected by this packet. |
| Registered IdP | Approved issuer, API audience, public key source/rotation, client registration and exact callback/redirect allowlists. Preserve existing RFC9068 validation; test keys do not approve company IdP. Collect secrets only through managed credential input. |
| Authorization flow | Specify state, nonce and PKCE validation where applicable, callback error handling and replay protection; prohibit caller-chosen issuer/upstream/redirect. |
| Session lifecycle | Specify storage, lifetime, renewal, idle/absolute expiry, permission freshness, disabled/revoked identity propagation and server logout. If cookies are selected, specify flags/path/domain and session fixation handling. Do not infer a browser session lifetime from API-token limits. |
| CSRF/CORS/ingress | Specify exact origin and TLS boundary, allowed methods/credentials, mutation CSRF checks and proxy trust. Existing bearer-only APIs must not become cookie-authorized accidentally. |
| Identity/bootstrap | Specify authorized binding provisioning/revocation, first-administrator bootstrap/recovery and self-escalation denial. Existing principal existence is not permission to administer resources. |
| Failure/privacy | Specify no-store, safe errors and redirect/log redaction. No raw bearer/proxy/provider secret in URLs, browser persistence, audit or operational logs. Retain mandatory authentication/decision/mutation audit behavior. |
| Operation and provenance | Identify listener/database/schema owners, public artifact exact HEAD, run command and approved local URL; distinguish schema/ingress deployment approval from contract review. |

An approver must identify the selected answers and artifact explicitly. Approval of this inventory or another source-only composition PR does not approve session runtime, DDL, ingress or deployment. Keep this packet unapproved until that record exists.

## First implementation and acceptance sequence

1. Backend/frontend confirm nonoverlapping files and exact contract. Create/update an English numbered implementation plan and public-boundary tests before production code.
2. RED: exercise the real public entry without injected test authority; require an actual approved authentication transition and a fresh current-principal response. Also require callback rejection/replay protection, expired/disabled identity and denial with no secret leakage. Do not let a fixture substitute for the approved IdP/session integration.
3. GREEN: implement the smallest approved acquisition/session adapter and page integration. Do not change model invocation permissions, token-owner authority or provider routes. Fresh server policy remains authoritative.
4. Demonstrate current principal → actual Models list/detail, loading/empty/error states and logout/expiry clearing. Record run command, URL, artifact HEAD and actual API responses separately from native-browser screenshots/interaction evidence. Retain a deterministic test IdP for local coverage, clearly labeled; company IdP acceptance is separate.
5. Exercise stale/detached controls, revoked binding, current Deny, failed mandatory audit and the chosen CSRF/CORS policy. Then perform native Audit CSV and cross-principal isolation acceptance. Credential mutations retain their one-time-secret/ambiguous-write protections.
6. Publish PR, independently review, require exact-HEAD full required CI and valid formal approval before merge. Do not transfer approval across ancestors or changed heads. Installed PostgreSQL, company SSO and real-provider E2E remain their own gates.

## What may proceed and what may not

Already approved nondependent local implementation may proceed while installation is blocked. Unapproved public simulator scope, blanket IAM administration, session policy or permissive bootstrap must not be invented as an alternative task. No additional minor display/guard patch counts as completing this login gate. No production binding, schema activation or paid call is authorized here.
