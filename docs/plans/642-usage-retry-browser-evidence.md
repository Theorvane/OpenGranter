# Usage retry native browser evidence (#642)

2026-11-10 04:00 KST execution. Actual Chromium page tools operated http://127.0.0.1:18843 (local test host, not deployment).

1. Production usage-app.ts built with buildManagementBrowser; actual loopback management HTTP, signed synthetic SSO access token forwarded only by test host, migrated PGlite and explicit candidate usage audit schema. No browser bearer token or session implementation.
2. Applied Request ID `req+1`, page size `1`: record time `.003Z`; unreported cost and tokens shown as Unknown, not zero.
3. Simulated mandatory SQL audit insertion outage via test host, clicked Next page: Usage unavailable; no records, details or CSV controls; Retry current page available.
4. Entered unsubmitted request text, recovered test audit, clicked Retry current page: same exact failed cursor loaded `.002Z`; submitted `req+1` restored, Previous page available.
5. Previous page returned `.003Z` without a cursor. Test host log verifies identical failed/retry query: `/management/v1/usage?request_id=req%2B1&limit=1&cursor=WzMsImF0dGVtcHQtMyJd&format=json`. Cursor copied, not calculated by application.

Harness/log outside repository: og-0400-browser.ts / og-0400-browser.log. Source and compiled-artifact signed SQL HTTP tests separately exercise audit failure/recovery and fresh Deny. No company SSO, installed PostgreSQL, provider/paid call or live release acceptance claim.
