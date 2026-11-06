# Explicit SSO management workspace HTTP

Plan: [640-management-workspace-http](../docs/plans/640-management-workspace-http.md).

The separately named createPostgresSsoManagementWorkspaceHandler and createPostgresSsoManagementWorkspaceServer are opt-in source factories, not changes to the read-only review API. They compose existing registered-key catalog/usage reads and [SSO token-management HTTP](sso-management-http.md) writes from one captured client, now, issuer, audience, jwks and newRequestId configuration. Extra caller authentication/audit/service ports cannot replace child enforcement.

Only POST /management/v1/proxy-tokens and POST /management/v1/proxy-tokens/revoke dispatch to token management; the original Request, body, headers, query and AbortSignal reach the child unchanged. All other requests retain the read-only review dispatch/rejection contract. No new route, permission, status mapping or data projection is introduced. Child success/error responses pass through without copying, caching or logging token secrets. Anonymous authentication failures, current owner-scoped iam:Manage, 30/90-day caps, decision audit and atomic credential lifecycle audit retain their existing contracts. Current binding/policy changes affect subsequent operations.

The server is constructed unbound with a private fixed no-store/nosniff 503 fallback. Caller owns SQL lifecycle, schema approval, TLS/listen and separately approved browser-session integration. No public asset, cookie, proxy-token-to-SSO bridge, inference, provider lookup, storage migration or runtime is enabled. No automatic retry or issuance deduplication is added; ambiguous outcomes require operator reconciliation. These factories do not expose audit-history reads under SSO.

Evidence is signed test JWT + migrated in-memory PGlite + loopback HTTP, not installed PostgreSQL, live IdP login, native-browser acceptance or provider E2E.
