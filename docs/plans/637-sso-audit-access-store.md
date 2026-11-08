# SSO audit-history access persistence (#637, #642)

1. Preserve the existing Bearer authentication, fresh IAM, scoped gateway metadata reader and explicit workspace writer opt-in. Do not change UI-owned files or introduce a startup wrapper.
2. Add an isolated SQL writer for SSO audit-history ACCESS metadata only: request ID, time, nullable human actor/policy versions, nullable target, outcome and result count. Never synthesize a proxy credential. Reject impossible attribution before SQL and project allowlisted fields synchronously.
3. Supply a candidate schema contract outside active migrations. Schema ownership/review, installation and committed SQL acknowledgement are required before deployment; implementation is not permission to activate DDL.
4. RED: new test imports the missing concrete writer. GREEN: real PGlite SQL, actual HTTP handler plus signed RFC9068 tokens, JSON/CSV, anonymous/denial/query/storage failures, awaited insert acknowledgement and no result on failed audit storage.
5. Validate invalid metadata/ACK/clock, mutation isolation, SQL error redaction, and no active migration change. Run regression/typecheck/lint/scripts, open a draft PR. Require exact-head CI and formal independent approval before merge.

## Contract cases

- ready/forbidden require actor, policy versions and target; invalid_query has actor but no target; anonymous has neither actor nor target nor versions. Unavailable can occur before or after authenticated target selection. Non-ready count is zero; count is an integer 0..100.
- Only a positive decimal returned event ID acknowledges a single INSERT row. Caller-owned transactions must commit before HTTP release; this writer cannot certify an external transaction commit.
- Store failure returns fixed private failure, which the existing service converts to audit_unavailable. Gateway metadata and retained content remain unchanged; no access-history reader is enabled.
