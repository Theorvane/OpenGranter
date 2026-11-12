# Owned canonical review runtime

`startPostgresSsoCanonicalReviewGateway` is explicit opt-in. It migrates and owns one connection and binds the caller-selected host/port. It serves existing canonical catalog, usage and audit JSON/CSV with fresh signed SSO and mandatory durable audit. No proxy-token mutation or inference endpoint is installed. Existing token-management runtime is unchanged.

Optional trusted `javascript` enables only the public static shell, not authentication. Cookies remain insufficient. Callers own artifact provenance and TLS/ingress approval; no default launcher activates this runtime.

Startup and shutdown retain private fixed errors and cleanup. Closing is idempotent and waits for active requests before releasing SQL. Failed migration or invalid canonical configuration closes an acquired connection without leaving a listener. Tests use loopback Fetch/PGlite, not installed PostgreSQL, browser login, IdP or live providers.
