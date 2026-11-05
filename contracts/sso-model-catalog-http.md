# Server-facing SSO catalog HTTP (#637, #641)

`createSsoModelCatalogHandler({newRequestId, catalog})` adapts the trusted `createPostgresSsoModelCatalog` service. `createSsoModelCatalogServer` returns an **unbound** Node server. Neither factory starts a runtime, issues a session or stores credentials.

- `GET /management/v1/models` returns `{object:'list', data:[model...]}`; an authorized empty list is 200.
- `GET /management/v1/models/{encodeURIComponent(exactAlias)}` returns a bare model. Encode the complete alias as one path component (e.g. `team%2Fchat`). Hidden, disabled and absent aliases all map to the service's 404 `unknown_model`.
- Models project only `id`, `object`, nonnegative safe-integer `created`, `owned_by:'opengranter'`. Candidate IDs, upstream model names, secret references, policies, claims and tokens are never serialized. Details must match the requested exact alias.
- Only explicit Bearer authorization is forwarded. Missing/malformed Bearer is passed as empty input to the trusted service so its current registered-key authentication and mandatory denial audit still run; cookies and client actor/request-ID headers are not trusted. Service authentication and audit failure map to 401 and 503 respectively, with fixed messages. Invalid service success for absent Bearer fails closed.
- The service must verify the API-specific signed JWT/current human binding, read fresh complete IAM/catalog, and await durable attributed SSO audit **on every call**. It is not permissible to substitute an unaudited/cached service, invent a proxy credential ID, or anonymize an authenticated actor. The HTTP adapter does not implement that durable storage.
- No query parameters or request bodies are supported. Reject any Transfer-Encoding or Content-Length other than exact `0`, including on the real Node boundary where GET bodies are discarded before Fetch adaptation. Only one encoded detail component is accepted; invalid percent encoding, empty components, dot segments, whitespace/control characters, `%`, backslash, `?`, `#`, or aliases over 512 code units are rejected. Request validation occurs before service work and yields 400 without a discovery/audit service call; unmounted paths/non-GET yield 404 without service work. This boundary never parses a body or reads query-borne tokens.
- Server-generated bounded correlation IDs are used for accepted routes; they are never copied from incoming headers. All outcomes, including Node adapter fallback, carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. No CORS headers or cookie authentication are enabled. 401 includes `WWW-Authenticate: Bearer`.
- Aborted requests never expose late data. Aborting does not roll back service work/audit or add atomic revocation. Unexpected exceptions and invalid projections produce fixed 503 errors without internal text.

## Browser and deployment boundary

This is a separate server-facing API namespace, not a change to proxy-token `/v1/models` or `/api/v1/models`. A trusted BFF must establish its reviewed OIDC/session/CSRF boundary and explicitly forward its server-held access token; browser code must not store bearer/proxy credentials. Existing frontend list/detail envelopes are compatible after that explicit route adaptation. This change does not mount the BFF, add session cookies, persist SSO audit, configure TLS/ingress, perform inference, reserve budget or claim installed acceptance. Local socket + signed JWT + migrated PGlite tests are not company-IdP/browser/installed-PostgreSQL/provider E2E.

## Optional durable PostgreSQL composition (#641)

createPostgresSsoModelCatalogHandler and createPostgresSsoModelCatalogServer in src/gateway/postgres-sso-model-catalog-http.ts accept the registered SSO configuration, SQL client and trusted request-ID factory. They explicitly wire the dedicated PostgreSQL SSO audit store into the fresh-authentication catalog service. The same trusted clock timestamps audit. No caller audit callback or service override is accepted; extra object properties do not alter composition. Existing HTTP semantics and migrations apply. The server is unbound; migrations, listening/TLS, SQL lifecycle and cookie/session/runtime integration remain caller-owned. The primitive dependency-injected service/HTTP constructors remain available but are not a durable-audit certification.

## Explicit transport client (#641)

createSsoManagementCatalogClient targets only the fixed management namespace for list and encoded detail. It accepts an already-authorized request port; it never obtains or forwards a credential, creates a cookie/session, or falls back to proxy discovery. Unlike proxy discovery, SSO has no count/user collection routes, so those exact aliases are valid detail targets. Shared response byte bounds, timeout, cancellation and status-only failures remain unchanged. Browser session integration still requires the separately reviewed BFF contract.

The explicit SSO transport rejects a whole list/detail success when a row violates the existing nonnegative safe-integer created or fixed OpenGranter ownership projection. The UI lifecycle clears prior content into retryable unavailable, without displaying malformed rows or private extras. Proxy transport decoding is unchanged.

SSO list rows must also satisfy the existing detail alias syntax and be encodable as one URL component. A malformed alias rejects the whole list rather than rendering a link that cannot open. Unicode, slash-containing aliases and count/user remain supported; proxy list decoding is unchanged.

## Explicit UI observer and expiry adapter (#641)

`createSsoManagementCatalogAuthority` composes the SSO lifecycle with trusted-grant expiry and rendering notifications. It reads only `/management/v1/models` and encoded detail aliases. The existing proxy authority remains separate. A new trusted grant starts a new identity epoch; expiry, denial, logout and disposal cancel pending work and remove protected snapshots. HTTP authentication and authorization remain server-enforced; this factory does not acquire a session or activate a browser/runtime.
