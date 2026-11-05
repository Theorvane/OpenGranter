# SSO usage history HTTP

GET /management/v1/usage accepts only Authorization: Bearer with the registered-key SSO configuration. Cookies, proxy credentials and client identity headers supply no authority. Query is passed unchanged to the existing scoped usage reader: principal_id, model, from_ms, to_ms, limit, cursor and format=json|csv. Authentication/IAM precedes parsing inside that service. Missing or malformed bearer is passed as empty to produce mandatory audited rejection.

JSON success is {object:"list",data:[allowlisted UsageRecord],has_more:boolean,next_cursor:string|null}. CSV success is text/csv; charset=utf-8 with attachment filename usage.csv. Both success formats have x-usage-has-more and, only when more pages exist, x-usage-next-cursor. A CSV response is one authorized page, not an automatic all-pages export. No inferred cost, usage, identity or billing fields.

Errors use fixed client-error envelopes: unauthenticated=401/unauthorized with WWW-Authenticate: Bearer, forbidden=403, invalid_query=400/invalid_request, unavailable=503/usage_unavailable, audit_unavailable=503/audit_unavailable. All responses no-store/nosniff; request IDs come only from the trusted generator. Exceptions never expose raw SQL, tokens, query or records. Unknown paths/methods are 404. Framed GET bodies, aborted requests and search text over 8192 characters reject 400 before service; these transport rejections do not claim an SSO data-access audit event.

createPostgresSsoUsageHistoryHandler/Server composes the actual database reader, registered-key authenticator and concrete awaited audit store; no injected no-op audit. Server is unbound and is not mounted into the installed management listener. Caller owns schema promotion/migrations, committed SQL, TLS, lifecycle and session bridging. Candidate audit schema is NOT an installed migration. No new CSRF/CORS/login/session decision is implied.

Plan: [642](../docs/plans/642-sso-usage-http.md). Tests: test/sso-usage-history-http.test.ts. Depends on #696/#697. No installed/browser/provider acceptance claim.
