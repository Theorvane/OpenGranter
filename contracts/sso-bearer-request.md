# Explicit SSO management bearer request (#639)

This opt-in adapter consumes a caller-approved API-specific SSO access token and trusted expiry. It is NOT an authenticator: it does not verify JWTs, acquire grants, implement login/logout/refresh, infer expiry, store credentials or activate any entry. Use the existing trusted session owner to mount and dispose UI and this adapter on logout, identity change and known expiry. Server RFC 9068, fresh IAM and required durable audit remain authoritative.

## Credential destination and Fetch controls

Only relative canonical management GET principal/me/models (including exact encoded model detail), usage and audit paths, and POST proxy-token issue/revoke are allowed. POST query strings, GET bodies, fragments, traversal, unknown methods, external and proxy endpoints fail locally. Only accept/content-type caller headers are accepted; alternate authorization, cookies and custom headers are rejected before transport. The adapter adds its in-memory bearer and forces same-origin mode, credentials omit, no-store and redirect error. It forwards only selected init fields, never retries, logs or reflects private transport diagnostics. The supplied fetch port is trusted and must honor native Fetch mode/abort semantics. An arbitrary replacement fetch implementation is not sandboxed by this helper.

## Lifetime and outcomes

Malformed supplied bearer/lifetime fails generically. Every request and late response checks the trusted clock and expiry. Disposal clears the retained credential, aborts the shared native-fetch lifetime, disables retained request handles and discards late response bodies. The host MUST dispose at known expiry: this adapter does not schedule expiry or guarantee interruption of a malicious/ignoring injected transport. A server 401/403/503 is returned unchanged for existing clients/session owners to process, not converted into authentication success. Cancellation cannot roll back a mutation, revoke an issued token or certify a missing response outcome. A completed downstream response or transport-held Headers cannot be erased retrospectively.

## Executable cases

- Unit tests cover canonical paths, bearer/forced controls, destination/header rejection, expiry/clock failure, retained handles, caller abort, disposal/late body cleanup, denial and diagnostic suppression.
- Real loopback HTTP connects Account plus issue/revoke clients through this adapter to the canonical signed-bearer operations server and PGlite migrations. Fresh IAM Deny and required-audit failure preserve credential count; invalid synthetic bearer remains unauthenticated.
- These tests are synthetic signing/PGlite evidence, NOT company IdP, native PostgreSQL, deployed browser, paid provider or installed acceptance.


## Explicit operations host composition (#639)

mountSsoManagementOperations(root, createDownload, options) composes the existing session operations mount with the bearer adapter, without changing the public browser entry. A trusted host calls authorize({accessToken, expiresAt, request}) only after approval by its existing SSO session and calls clear() on logout or identity change. This is not a token acquisition/verification or cookie/BFF contract. Account, History and Token controls keep their existing canonical API, IAM and audit contracts.

Replacement, logout, expiry, fresh 401/403 and disposal release the outgoing bearer lifetime and private UI. Expiry uses trusted asynchronous scheduling and a generation fence, so cancelled callbacks cannot clear replacement authority. Scheduling failure removes the session; generic network/503 failures do not manufacture Deny. Accepted server mutations cannot be rolled back by abort. The caller still owns approved identity-change notification; no provider credentials, browser storage, login refresh or automatic entry activation are added.

Cases: approved Account loading/read; logout abort and detached refresh suppression; replacement credential isolation and stale timer; expiry without another request; terminal fresh 401/403 versus retryable 503; malformed credentials; scheduler failure; real loopback canonical HTTP active-principal revocation. Synthetic signed SSO/PGlite and structural DOM evidence are not company IdP, native PostgreSQL, native browser or installed acceptance.
