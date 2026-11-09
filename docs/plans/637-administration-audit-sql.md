# Administration audit SQL integration (#637 / #642)

1. Preserve source-only administration composition and runtime/session defaults. Its audit route requires a caller callback although the concrete SQL-backed HTTP boundary already exists.
2. Add explicit own auditHistoryClient opt-in reusing that boundary. Reject invalid clients and ambiguous callback plus SQL configuration. Preserve omitted-port 404 and existing callback integration.
3. Before production changes reproduce missing-route RED with signed test SSO, real loopback administration HTTP and migrated PGlite plus separately reviewed access-audit schema.
4. Verify JSON pagination, CSV, principal isolation, fresh denial/revocation, no-store/redaction, missing-table fail-closed and awaited SQL acknowledgement. Exercise existing compiled Audit UI against actual composition without read-result stubs.
5. Run focused tests, type/lint/planning checks and full check; open stacked PR, request independent exact-head formal approval, never merge without all stack gates.

## Boundaries

No new session, CSRF/CORS policy, authority acquisition, schema promotion, runtime activation, provider calls or deployment. SQL acknowledgement must mean committed/autocommit writes; factory cannot certify external transaction commit. Embedded SQL and synthetic SSO are not installed PostgreSQL/company-login acceptance.
