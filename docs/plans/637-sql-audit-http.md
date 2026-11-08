# SQL-backed SSO audit history HTTP (#637 / #642)

1. Keep frontend ownership, runtime defaults, sessions and candidate schemas unchanged.
2. Add a concrete Bearer-only HTTP composition pairing the registered-key verifier, fresh IAM reader and SQL access-audit store. Require an explicit audit client; never accept a callback writer override.
3. Before implementation, run an acceptance test expecting the missing concrete factory. Then verify real loopback HTTP, scoped JSON/CSV and queryable access audit, denial/revocation, missing table fail-closed and delayed SQL acknowledgement.
4. Validate both SQL clients and request-ID source synchronously without querying, sanitize configuration failures. No automatic schema installation or commit guarantee: callers supply approved schemas and committed/autocommit clients, and own lifecycle/TLS.
5. Run focused tests, full typecheck/lint/scripts checks, push a draft PR, request exact-head formal review. No merge before all required CI and approval. Embedded SQL/fixture identity are not installed PostgreSQL or company SSO certification.
