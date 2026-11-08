# Current-principal Account view (#637 / #639)

`mountSsoUsageWorkspace` now has Account navigation using the existing authenticated `GET /management/v1/me` contract. It shows the exact returned active-human principal ID as text only. Identity is explicitly not permission to administer resources. A trusted existing authority port is still required: this is not login/logout, a BFF, a cookie/session implementation or a public grant injection API.

Account dispatches GET with no-store, redirect:error and credentials:omit. No query, body, actor ID, proxy fallback, automatic retry, bearer acquisition or browser persistence. Responses require application/json, fatal UTF-8 and one exact principalId field: 1–256 UTF-16 units, well-formed Unicode, no NUL. Response streams are bounded at 4096 bytes (including actual bytes when length is absent or false); a 30-second deadline interrupts transport/body work even when the port ignores abort. Extra claims, malformed bodies and private errors cannot be displayed. Non-200 bodies are cancelled without reading.

Loading, sign-in-required, denied and unavailable states replace prior private identity. Navigation, grant replacement, expiry, pagehide and disposal cancel and suppress stale work. Current 401/403 clears shared host authority; stale responses cannot clear replacement authority. Returning to Account requests identity afresh rather than caching it.

Acceptance: source and built public module traverse signed test SSO, actual loopback HTTP and migrated PGlite. Reads require no IAM attachment and create none. Current inactive principal and removed binding yield 401; missing required anonymous auth audit yields 503. Private subject/issuer/JWT are absent from stored audit. Catalog-only requests in this identity-specific test are explicitly stubbed.

These are local test results, not native-browser/real-IdP login, installed PostgreSQL, session approval, provider calls or deployment acceptance. No endpoint, policy grant, migration or runtime activation is added.

## Explicit unavailable-state recovery (#637 / #639)

Account and Audit identity preflight offer `Retry current principal` only after an unavailable response, transport/parser failure or deadline. One explicit click reruns the existing read; there is no automatic retry, backoff, mutation replay or new authority. Audit retries resolve current identity again before requesting audit data. Authentication/authorization failures remain terminal with no retry.

The view consumes a retry control once and invalidates it on rerender/disposal. The workspace additionally checks its render revision, active lifecycle and current grant deadline before rerendering. Navigation, renewal, clear, expiry, pagehide and disposal prevent detached controls from dispatching. Suspended expiry timers do not extend authority. A mount without an explicit trusted host recovery callback exposes no retry.
