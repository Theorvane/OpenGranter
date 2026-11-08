# Exact principal-scoped usage request tracing

GET /v1/usage and /management/v1/usage accept optional request_id for JSON/CSV, exact case-sensitive 1–256 characters matching /^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/. Reject duplicates, empty/whitespace/control/SQL-like and overlong values. Intersect principal, model, inclusive from_ms, exclusive to_ms and keyset cursor. Preserve ReadSelf/ReadAll and mandatory audit. Bind SQL parameters, validate all rows including lookahead and fail closed on mismatches. No cross-principal global request search.

The usage screen adds Request ID and a Trace usage request action on authorized attempts. Retain submitted bounds, discard drafts/history/cursor and stale CSV. Subsequent paging/CSV preserves the request. Empty means no attempts in authorized scope, not that a request never existed. Duplicate/retry/unknown cost markers remain evidence, not reconciliation. No IAM/schema/session/runtime/provider changes.

Acceptance: parser RED/GREEN; SQL interleaved matching/unmatched/foreign attempts and hidden lookahead; proxy/SSO JSON+CSV propagation with auth/audit unchanged; source/artifact control lifecycle and browser client rejection of mismatched JSON; no native-browser/live-SSO/installed-Postgres claim from local fixtures.
