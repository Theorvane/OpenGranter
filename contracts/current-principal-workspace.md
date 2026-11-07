# Current-principal Account view (#637 / #639)

`mountSsoUsageWorkspace` now has Account navigation using the existing authenticated `GET /management/v1/me` contract. It shows the exact returned active-human principal ID as text only. Identity is explicitly not permission to administer resources. A trusted existing authority port is still required: this is not login/logout, a BFF, a cookie/session implementation or a public grant injection API.

Account dispatches GET with no-store, redirect:error and credentials:omit. No query, body, actor ID, proxy fallback, automatic retry, bearer acquisition or browser persistence. Responses require application/json, fatal UTF-8 and one exact principalId field: 1–256 UTF-16 units, well-formed Unicode, no NUL. Response streams are bounded at 4096 bytes (including actual bytes when length is absent or false); a 30-second deadline interrupts transport/body work even when the port ignores abort. Extra claims, malformed bodies and private errors cannot be displayed. Non-200 bodies are cancelled without reading.

Loading, sign-in-required, denied and unavailable states replace prior private identity. Navigation, grant replacement, expiry, pagehide and disposal cancel and suppress stale work. Current 401/403 clears shared host authority; stale responses cannot clear replacement authority. Returning to Account requests identity afresh rather than caching it.

Acceptance: source and built public module traverse signed test SSO, actual loopback HTTP and migrated PGlite. Reads require no IAM attachment and create none. Current inactive principal and removed binding yield 401; missing required anonymous auth audit yields 503. Private subject/issuer/JWT are absent from stored audit. Catalog-only requests in this identity-specific test are explicitly stubbed.

These are local test results, not native-browser/real-IdP login, installed PostgreSQL, session approval, provider calls or deployment acceptance. No endpoint, policy grant, migration or runtime activation is added.

### Suspended-timer presentation boundary
The host rechecks current trusted authority at each Account response/body continuation and immediately before identity presentation, even when the expiry callback has not run. Expired or invalid host clocks clear shared authority; a late payload cannot display identity or retain credential access. Local stale-work checks run first so an obsolete Account completion cannot clear a replacement grant. This is local lifecycle enforcement, not session acquisition or server authorization.

## Shared Usage presentation boundary (#637 / #642)
The existing Usage view rechecks current host authority before publishing asynchronous read or CSV completion, including suspended timers and invalid clocks. Invalid/throwing/negative clocks fail closed without leaking errors. Host expiry clears shared credential authority. Superseded work cannot clear a replacement grant. No session/API/DDL activation is implied.

### Explicit Account recovery (#637 / #639)
The existing UI may explicitly retry unavailable GET /management/v1/me using the current trusted transport; no automatic retry, identity cache, session grant or API change is introduced. Malformed responses and timeouts use the same bounded read path.401/403 have no recovery control. A handler is valid only within its render revision and current host authority; navigation, renewal, clear, hide, dispose and expiry invalidate it.
