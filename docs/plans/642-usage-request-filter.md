# Request-scoped usage history (#642)

1. Port the existing PR742 backend request_id filter onto canonical main without the stale legacy UI stack. Add an optional exact request_id filter to existing principal-scoped usage queries.
2. Validate the existing exact case-sensitive 1–256 ASCII identifier matching /^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/; reject duplicate/empty values.
3. Parameterize canonical SQL and revalidate all returned rows, including lookahead.
4. Forward through existing proxy and SSO usage readers; preserve fresh IAM, mandatory audit, JSON/CSV pagination and cost uncertainty.
5. Prove RED/GREEN with embedded PostgreSQL and signed SSO Fetch requests. No session issuance, UI ownership, schema, deployment or provider changes.
