# Canonical read-only management composition (#637, #639, #642)

1. Reuse canonical signed-SSO catalog, usage and audit Fetch handlers with one trusted SQL client. Do not revive legacy auditClient, callback overrides or Server factory names.
2. Add a separate explicitly constructed handler and unbound Node server. Route only exact usage/audit paths and catalog list/detail namespace; optionally wrap the existing public shell. Do not modify runtime defaults, session, credentials, IAM, migrations or provider routing.
3. RED: a composition with only catalog/usage leaves audit unreachable. GREEN: real loopback HTTP with PGlite and signed JWT reaches all three boundaries, preserves filtered JSON/CSV isolation and waits for mandatory durable audit.
4. Test unknown/write/proxy routes, invalid optional artifact, fresh binding revocation, missing audit persistence and public shell without inferred authority. Run canonical regressions, typecheck, lint and planning checks; submit exact-head PR for independent formal approval and mandatory CI before any merge.

This is opt-in API composition, not browser login, default audit activation, approved deployment or installed PostgreSQL acceptance.
