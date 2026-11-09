# Management audit request correlation (#637, #642)

The mounted audit view exposes **Request ID (exact, case-sensitive)** alongside principal, model and UTC bounds. Empty form input means no request filter. Nonempty input is never trimmed, lowercased or interpreted as authority. The browser client passes `requestId` as `request_id`, URL-encoding plus as `%2B`, and applies the same strict grammar as the API before sending JSON or CSV requests. Invalid programmatic filters fail before transport.

Current-page next, previous and CSV preserve the captured exact filter. JSON is reprojected against principal, request ID, model/time bounds and cursor before display: a mismatched response fails closed, without displaying its records. Existing CSV is a bounded authorized server page, not a browser-revalidated full-history export. Every API read still requires fresh IAM and mandatory attributed audit. A request ID is only correlation and grants no access.

Denial, expiry and authority replacement retain existing page/export/draft cleanup. The form uses text/value properties, not HTML injection, and persists no filter or bearer credential. No new session/BFF, role, retention, cookie, schema, listener or deployment activation.

Evidence: `test/management-audit-request-filter.test.ts` covers structural mounted DOM, strict browser-client transport and actual signed test SSO → SQL → loopback HTTP paging/CSV/denial. Test SSO and PGlite are not company login, installed PostgreSQL or native-browser session acceptance. See [plan](../docs/plans/642-audit-request-ui.md).
