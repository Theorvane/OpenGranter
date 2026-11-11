# Isolated backend usage request trace (#637 / #642)

GET /management/v1/usage and GET /v1/usage accept optional request_id for JSON/CSV. Reuse #760: exact case-sensitive 1–256 characters matching /^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/. Reject duplicate, empty, whitespace/control, SQL-like and overlong values.

Intersect authenticated/explicitly authorized principal, model, inclusive from_ms, exclusive to_ms and opaque keyset cursor. Explicit principal selection still requires ReadAll. Use bound SQL parameters and validate returned rows including hidden lookahead. Capture the reader's query and nested cursor before asynchronous SQL (#838). A requested identifier never grants access to another principal's attempts. Empty means none in this authorized scope, not proof that a request never existed.

Mandatory durable SSO metadata audit precedes response publication; audit failure withholds JSON/CSV. Never store the search request_id as the server audit request ID or persist raw query strings. Existing usage/cost/duplicate markers are not reconciliation.

This isolates backend functionality from #760/#838 onto the #855/#859 runtime stack. It does not bring the old UI/session stack, browser filter controls, requestId browser-client option, DDL, cookie/BFF, listener opt-in changes or deployment. Frontend owns typed filter/control integration separately. Embedded PGlite + signed test JWT + actual loopback HTTP evidence is not native-browser/company-IdP/installed-PostgreSQL/provider acceptance.

Plan: [execution](../docs/plans/642-request-filter-main.md).
