# Opt-in audit review page

## Issue and problem
- Issue: #784; parent #637 / #642.
- The bounded #782 audit reader has no audit review DOM surface.

## Scope and expected behavior
- Add an opt-in read-only component: exact principal/model and UTC time filters, first/next page, loading, empty and private failures.
- No session/SSO wiring, endpoint, retention, CSV, runtime activation or provider calls. Existing authorization/audit remain in the injected #782 client transport.

## Design
- Mount disconnected; connect accepts only an explicitly supplied bounded audit client. Caller must clear on logout/expiry/identity or permission changes and dispose on unmount. Connection is not authentication or an authorization decision.
- Clear previous records before every query, reject stale callbacks, preserve opaque next cursor only for unchanged submitted filters, render fixed columns using textContent only. Never render arbitrary details or errors.
- Alternatives: modifying the shared workspace risks frontend ownership conflicts; defer integration to its owner. Session/BFF and content-audit decisions remain unresolved.
- Contract: contracts/audit-review-page.md; PRD and acceptance receive bounded addenda. No architecture/security decision is settled here.

## TDD plan
- RED: import missing audit-page.ts with public DOM behavior tests.
- GREEN: disconnected, filters, paging, safe text, empty, denial/failure, stale requests/buttons and lifecycle clear/dispose tests.
- Run focused tests, typecheck/lint, planning checker and npm run check; disclose resource failures separately. Bundle and real headless browser smoke distinguish synthetic transport from installed E2E.

## Delivery
1. Record plan and contract cases, run RED before production code.
2. Implement component and run GREEN; capture browser evidence.
3. Commit on feat/784-audit-page and open draft PR against dependency #783.
4. Request exact-head independent formal approval and CI; no merge without both. Rollback by removing the unused opt-in component.

## Follow-up: fresh previous-page navigation
- Within #784/#642, add Previous page using only prior submitted query/cursor metadata, never cached event rows. Re-fetch through the bounded client so current IAM and mandatory audit are re-evaluated.
- Store history only after a successful current response. Clear history on loading, failure, invalid filters, new filters, first page, disconnect and disposal. Stale completions and detached buttons must not restore history.
- RED/GREEN: three-page round trip, opaque cursors, edited but unsubmitted drafts, denial, filter reset, superseded request, public bundled module. Actual Chromium plus loopback gateway must show fresh HTTP on Previous and denial clearing rows.
- No authentication/session, API, SQL, runtime activation or frontend-owned workspace changes. Re-request exact-head review and CI after the follow-up commit.

## Follow-up: bounded current-page CSV
1. Add RED cases for a separate fresh read of submitted scope, fixed visible columns, formula-safe encoding, empty output, denial, stale completion, download revocation and built module.
2. Reuse the existing bounded JSON client and shared CSV encoder; export only the six visible metadata columns, at most the current 25-row page. No automatic pagination, arbitrary detail export, SSO bridge or backend changes.
3. Prepare requires a fresh authorized/audited API read; clear old rows/download immediately. Publish a Blob download link only after the latest successful response; revoke it on any new query, invalid filters, clear, replacement or disposal. Detached links must not trigger a download.
4. Run focused RED/GREEN, checks and real Chromium download against loopback gateway, then same PR exact-head review and CI. No installed/real-provider claim.

## Integration follow-up: catalog landmarks (#637 / #639)
1. Native Chromium against the existing same-origin administration host exposed nested main landmarks: public main#app contains catalog-view main. Keep the public shell and all authority/session boundaries unchanged.
2. RED source and restricted built-module tests across idle/loading/empty/list/detail/missing/unavailable must retain exactly one owner main and one labelled Model catalog region.
3. Replace only catalog-view inner main with a named section; retain headings, controls, focus, text-only data and all request behavior. No workspace or public entry changes; coordinate this narrow file with frontend.
4. Run focused catalog/workspace/build regressions and typecheck/lint/planning; repeat native Account/catalog/confirmed credential success, fresh Deny, binding revocation and mandatory audit failure against actual loopback HTTP plus migrated PGlite and explicit candidate Account DDL. Test-runner signed SSO authority is not company login or deployed acceptance.
5. Deliver on existing PR785, supersede exact-head review and CI; do not merge without formal approval and all required checks.

### Landmark execution evidence (2026-11-08 KST)
- RED: source and built-module regressions both fail with two main landmarks (0/2 pass). GREEN: 38 focused catalog/workspace/build/administration tests plus 36 audit/durable Account integration tests pass, zero skipped. Typecheck, lint, planning/link/secret checks, pinned compatibility and diff checks pass.
- Actual Chromium156 through the existing administration host: Account200, confirmed issue201/revoke200, fresh Deny403 with no second credential, encoded model list/detail200 and policy-scoped empty list, inactive identity Account401 clears identity, required dedicated Account audit-table failure Account503 hides identity, pagehide clears authority, one main plus one named catalog region, zero JavaScript errors.
- Harness corrections before final success: exact Account locator, explicit isolated candidate Account DDL, explicit renewed test grant after Deny and waiting for catalog completion before identity revocation. Initial failures are not production-success evidence.
- Loopback listener closes after smoke; no persistent execution URL. Signed test authority is supplied only by the runner, not browser login. No installed schema approval, company IdP, live provider or deployment claim. Whole local check remains previously resource-failed; new exact-head CI and formal approval are required.

## Usage authority integration follow-up (#637 / #642)
1. Reproduce usage response/body completion with suspended timers and deadline, nonfinite, throwing or negative trusted clocks in source and built workspace. Assert expired UI and no retained credential mutation authority.
2. Add a guarded host presentation callback to the existing Usage mount, evaluated after local revision/disposal checks. Harden Usage clock reads and initial deadlines; do not alter session, APIs, schema or runtime activation.
3. Verify replacement grants cannot be invalidated by stale continuations; retain loading/empty/error and fresh CSV behavior. Run focused regressions, native actual-HTTP browser smoke and checks.
4. Commit on existing PR785; require new exact-head CI and formal approval. No merge or deployment without existing gates.

### Usage integration execution evidence (2026-11-08 KST)
- Meaningful pre-fix RED:16/16 source+built response/body cases fail; final suite includes JSON/CSV and renewed-grant isolation. Invalid clock throws leaked as unhandled rejection, negative clock published a page, and even ordinary expiry left shared credential authority recoverable after clock correction.
- Native Chromium156: actual usage200 and one durable usage audit held across absolute expiry with no timer firing; protected output cleared and Issue token remained disabled after clock recovery. No mutation dispatch or page errors. First harness lacked explicit candidate usage audit DDL and correctly received503; corrected isolated runner only.
- Session, API, IAM, SQL migration and runtime activation remain unchanged. Browser listener closes after smoke; no persistent user URL.
