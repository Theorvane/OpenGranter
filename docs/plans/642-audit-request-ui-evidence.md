# Local audit request UI evidence (#637, #642)

Scope: source-only integration of the management audit form/client with PR830's exact request filter. Not browser login, installed PostgreSQL, company SSO, provider inference or deployment acceptance.

## Automated evidence

1. Before production changes, `management-audit-request-filter.test.ts`: 3 tests failed meaningfully. Browser request omitted request_id; mounted form lacked the field; real signed SSO SQL HTTP workspace returned another request's row on the second page.
2. After wiring: new suite plus existing client/workspace and request-filter API suites: 24 tests passed, 0 failed, 0 skipped. A subsequent typecheck found an unknown SQL test-row type; corrected with an explicit result type. No production type suppression.
3. Whole-project typecheck and planning/link/fixture-secret scan passed. Full check and remote exact-head CI are tracked in the PR rather than assumed from these targeted results.

## Native browser, local synthetic integration fixture

The temporary harness at `http://127.0.0.1:18840` bundles the actual `mountManagementAudit` source. A test-only host port forwards reads to the actual registered-key SSO HTTP server with a synthetic signed test token and migrated PGlite SQL. The token is never emitted to browser JavaScript. This deliberately does not implement, approve or test a cookie/BFF/company-login boundary.

Browser actions on 2026-11-10 KST:

1. Initial unfiltered page rendered five authorized human events and no other-principal events.
2. Enter `req+1` in Request ID and apply: exactly the two matching rows remained; `Req+1` and `event-human` were absent. The input retained its exact value.
3. Export current page CSV: downloadable audit.csv and the existing preview contained only the two exact request matches and the page-only notice.
4. Replace with `absent`: No audit events, no old rows or CSV preview.
5. Replace with `req bad`: Invalid audit filters, no rows or active export.
6. Select principal `other`, request `req+1`: Access denied; form, rows and export were removed.

Temporary in-memory fixture availability is not a supported deployment URL. Browser paging/expiry and real company login are not certified by these manual actions; pagination/CSV/filter capture and cleanup have separate automated evidence. No production, ingress, schema promotion or paid call occurred.
