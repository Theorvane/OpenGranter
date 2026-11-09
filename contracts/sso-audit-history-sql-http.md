# Concrete SQL-backed audit history HTTP

`createPostgresSsoAuditHistoryHandler` and the unbound server factory in
`src/gateway/postgres-sso-audit-history-http.ts` pair existing RFC9068 verification,
fresh IAM `audit:Read` authorization, scoped gateway metadata JSON/CSV and the
SSO access-audit SQL store. They do not accept callback authentication or audit
overrides. Only exact GET `/management/v1/audit` dispatches; cookies confer no
authority. Existing HTTP query, cursor, redaction and no-store rules apply.

The trusted caller explicitly supplies both `client` and `auditClient`. Own
configuration fields and functional query/request-ID ports are required before
any query; construction errors are sanitized. Clients may be identical only when
their SQL acknowledgement has the required committed/autocommit semantics. The
factory cannot certify transaction ownership or a separate external COMMIT.

Access-audit failure withholds JSON, CSV and authentication results with 503.
An awaited INSERT acknowledgement is necessary but not a guarantee that an
externally owned transaction has committed. Never mount with such an uncommitted
transaction. `sso_audit_history_access_events` remains a review-candidate schema;
this factory does not install it or promote a migration. Missing schema fails
closed. It does not activate the existing browser/workspace process, issue a
session, grant IAM rights, bind a listener, or manage a database connection.

Acceptance uses loopback HTTP, fixture signed identity and disposable embedded
SQL. These are not installed PostgreSQL durability, native browser SSO, approved
schema installation or paid provider E2E evidence.

## Exact request correlation (#641)

Optional `request_id` selects the projected event request ID, never arbitrary details. One value, 1..256 characters, `[A-Za-z0-9][A-Za-z0-9._+:/@-]*`; matching is case-sensitive (encode plus as `%2B`). Empty/duplicate/invalid values fail the existing invalid-query path after authentication. Principal scope, `audit:Read`, fresh IAM and mandatory audit are unchanged. Combine with model/time/cursor filters for JSON or CSV; every continuation request must retain its filters. SQL binds the ID as a value and validates the entire result including lookahead. Query values are not added to access audit records. No session, UI, runtime or deployment grant.
