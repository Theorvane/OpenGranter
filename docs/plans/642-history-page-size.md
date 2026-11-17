# Explicit history page sizes (#642)

1. Expose the existing authorized history API limit (1..100) in both Usage and Audit filters. Blank retains the server default; apply starts a fresh page, never an old cursor. No server grants or defaults change.
2. Add failing DOM cases for boundaries, invalid input without a request, pagination and current-page CSV consistency, independent destination scope and retained-control disposal. Add signed-JWT loopback HTTP with migrated PGlite covering scoped pages and durable audits.
3. Parse canonical unsigned integer text, defer range validation to existing clients, never clamp or turn invalid input into an unbounded query. Preserve applied limits through retries, previous/next and request investigations; unsubmitted drafts cannot change an export.
4. Execute tests, browser build, type/lint/document checks; open exact-head PR and obtain independent review/full CI before merge. Browser/company IdP/native PostgreSQL/installed/provider evidence remains separate. No entry/session/CSRF/CORS/policy/DDL/runtime activation or paid calls.
