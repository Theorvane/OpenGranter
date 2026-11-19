# Explicit PostgreSQL SSO usage runtime (#854)

The existing explicitly started `startPostgresSsoManagementGateway` routes only the exact `/management/v1/usage` pathname to `createPostgresSsoUsageHistoryHandler`. Query parameters and the Request remain unchanged. `/v1/usage`, suffixes and trailing slash are not aliases. Existing catalog, proxy-token and optional static-browser dispatch remain unchanged.

The usage handler shares the listener-owned migrated SQL connection, trusted RFC9068 issuer/audience/JWKS/clock and request-ID source. It performs fresh SSO binding/policy evaluation for every request; self versus explicit target permissions and Deny precedence remain the existing service contract. No new credentials, proxy-token bridge, cookies, CORS/session/CSRF policy or defaults are introduced. The caller must explicitly start the existing listener. No schema changes or upstream calls occur.

Successful JSON and CSV responses require successful awaited durable `sso_usage_audit_events` append; missing/expired/unbound tokens, invalid queries, Deny and SQL errors retain existing private statuses and mandatory audit behavior. Audit failure suppresses data with 503, including otherwise unauthorized reads. Responses use no-store and nosniff. Cost and usage uncertainty remain unchanged.

## Acceptance cases
- Real loopback HTTP, signed in-memory JWTs and migrated embedded SQL, both API-only and optional static-browser modes: JSON and CSV, scoped filters, opaque continuation, no foreign rows.
- Existing production JSON and CSV request adapters can consume the runtime responses without an alternate API origin or token conversion.
- Missing/expired/unbound/revoked binding denies; explicit Deny overrides Allow; another target without ReadAll denies; malformed query/method/path fails closed.
- Durable audit records contain actor/policy-version metadata; audit and SQL failure return private errors and no usage page.
- Catalog/token/static dispatch remains intact; one connection is opened and closed, idempotent shutdown closes the socket.

This is local API integration, not browser login, installed PostgreSQL certification, deployment authorization or live provider acceptance. Session contract approval and frontend integration remain separate.
