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

## Account explicit error recovery (#637 / #639)
1. Reproduce missing explicit recovery from Account unavailable using source and built browser workspace, including real HTTP mandatory-audit failure. No automatic retry.
2. Add a Retry current principal button only for unavailable (transport, malformed response or timeout). Reuse the existing guarded read and bounded parser; never retry authorization denials or retain a live handler across navigation, renewal, logout or expiry.
3. Verify one fresh GET per explicit retry, loading suppression, detached-handler rejection and durable HTTP recovery without fabricated identity or audit. Keep session/API/schema/runtime unchanged.
4. Publish on PR785; supersede exact-head review and CI. Preserve formal approval, dependency and deployment gates.

### Account recovery execution evidence (2026-11-08 KST)
- Pre-fix RED:14 failing recovery/stale-handler cases, four existing denial cases pass. Final new source/built suite24/24; combined Account/Usage regressions138/138, zero skipped. Typecheck, lint (42 existing warnings), planning/link checks, pinned compatibility and diff checks pass.
- Actual Chromium156 through existing administration HTTP and migrated PGlite: Account200, mandatory audit503 removes identity, one explicit Retry GET recovers200 and second durable successful Account audit; no mutation dispatch or page errors. Candidate Account audit DDL is isolated runner setup, not installed approval. Listener closes after smoke; test-runner signed SSO is not company login.
- Production change is one existing principal-app file; no session, API, IAM, DDL, migration or runtime activation change. Prior resource-limited full-check failures remain; no new local whole-check success claim.

## Catalog navigation lifetime (#637 / #639)
1. RED source and bundled tests for detached list/detail/refresh/retry controls across navigation, loading, renewed authority, clear, expiry and disposal; verify no new request or cancellation of current work.
2. Bind every catalog action to the render snapshot and consult authority.snapshot() before dispatch (including suspended-timer expiry). Reuse existing server authentication/IAM/audit; no session, API, DDL or runtime changes.
3. Verify current buttons still navigate, stale callbacks cannot consume replacement authority, and real Chromium through actual catalog HTTP sends no detached request. Run focused regression and static checks.
4. Publish on existing PR785, superseding exact-head review and CI. No merge without formal approval and dependency gates.

### Catalog lifetime execution evidence (2026-11-08 KST)
- Meaningful pre-fix RED18 failures/24 existing guards pass. Source and bundled suite42/42 and combined catalog/Account/workspace/actual HTTP regressions105/105 pass, zero skips.
- Native Chromium156 through actual administration HTTP, migrated PGlite and runner-signed SSO: list200/detail200, double click exactly one detail read, three detached controls after renewal produce zero reads, current navigation still reads200, suspended-timer expiry produces zero reads. Zero page errors. Loopback listener closes after smoke; not company IdP login or installed acceptance.
- Initial typecheck caught nullable test AbortSignal capture; corrected to undefined. No production contract widening. Prior whole-localcheck resource failures remain; exact-head CI/formal approval still required.

## Catalog explicit error recovery (#637 / #639)
1. Reproduce inability to retry an unavailable list or selected detail with source and bundled UI, including HTTP mandatory-audit failure. Denied and missing results must not offer retry.
2. Add an explicit Retry model lookup action only for unavailable; retain the selected target, use existing fresh authenticated/audited GET and reject detached controls. No automatic retries or API/session/schema/runtime changes.
3. Verify detail recovery without an intermediate list request, loading suppression, malformed-body recovery, renewal/clear/expiry/navigation/disposal isolation and actual HTTP browser recovery.
4. Publish on PR785; require superseding exact-head CI, formal review and inherited dependency gates before merge.

### Catalog recovery execution evidence (2026-11-08 KST)
- Pre-fix RED18 failures/6 denial guards pass. A mistaken test-only API prefix was corrected to the existing /management/v1/models contract; no API path changed. New source/built suite24/24; with prior lifetime suite66/66 zero skipped.
- Native Chromium156 through actual administration HTTP and migrated PGlite: list200, mandatory catalog audit failure detail503, explicit retry detail200 without intermediate list or automatic retry. Double click sends one GET; detached retry sends none. Successful list/detail audits are durably present; failed audit did not expose detail. Zero page errors. Loopback listener closes after smoke, not a persistent URL. Runner-signed SSO is not company login/installed acceptance.
- Production edits stay in existing catalog view/composition; session/API/IAM/schema/runtime activation unchanged. Require new exact-head CI, independent formal approval and dependency gates.


## Usage current-page recovery (#637 / #642)
1. Reproduce loss of the selected usage cursor and backward history after a failed page read. Cover transport, malformed response and mandatory audit unavailability in source, browser artifact and actual HTTP.
2. Add explicit Retry current usage page only for unavailable list reads. Retain submitted query/history only, not rows or bodies; fresh existing authenticated/audited GET only, no automatic retry, API/session/schema/runtime changes or CSV mutation replay.
3. Verify same target without first-page hop, backward navigation, denial/invalid-query exclusion, double-click and detached-control isolation across renewal, clear, expiry, navigation and disposal. Run native Chromium and regression/static checks.
4. Publish PR785 with superseding exact-head formal review and CI; inherited dependency gates remain required.

### Usage recovery execution evidence (2026-11-08 KST)
- Meaningful pre-fix RED16 failures/6 denial guards pass; final source/built recovery26/26 and combined Usage/workspace/actual HTTP regressions121/121 pass with zero skips. The initial test-only empty page with has_more=true was corrected to a valid nonempty first page before recording RED/GREEN; production response validation is unchanged.
- Native Chromium156 through actual administration HTTP, migrated PGlite, isolated candidate audit DDL and runner-signed SSO: scoped list200, page-size1 list200, mandatory audit failure selected cursor503, explicit same-query/cursor200, fresh previous-page200. Four successful durable usage audits; failed audit exposed no rows. No automatic retry, double click one GET, detached retry zero GET, zero page errors. Loopback listener closes after smoke; not company IdP, installed PostgreSQL, provider or deployment acceptance.
- typecheck, lint (42 existing warnings), planning/link/fixture-secret scan, pinned compatibility and diff checks pass. Whole-localcheck resource failures from prior executions remain; new exact-head CI, formal approval and dependency gates are still required.

## Audit row scope drilldown (#637 / #642)
1. RED source and bundled cases for principal/model row actions, submitted-filter preservation, first-page reset, missing model, exact encoding, failure and stale control isolation.
2. Reuse the bounded audit list client for explicit fresh principal/model queries, not local row filtering. Preserve other submitted filters, discard draft edits, cursor, history, rows and CSV links. No new session, API, IAM, schema or runtime activation.
3. Verify actual authorized HTTP query paths and browser behavior alongside audit regression/static checks. Trusted host still owns clear on logout/expiry/permission changes.
4. Publish PR785, request superseding exact-head formal approval and CI; do not merge without inherited dependency gates.

### Audit scope drilldown execution evidence (2026-11-08 KST)
- Corrected-fixture pre-change RED28 failures/2 missing-model guards pass; final source/built suite30/30 and audit client/page/browser-build/actual HTTP regression72/72 pass, zero skips. Initial HTTP fixture had invalid event projection fields/continuation; corrected only the test fixture, not validators.
- Native Chromium156 using the approved audit view bundle, runner-owned bounded client bridge, actual /v1/audit, migrated PGlite and injected test authenticator: first200, next200, fresh model scope200, principal scope200, mandatory-audit failure503, IAM Deny403 before history read. Four durable success audits, double click one GET, detached action zero GET, zero page errors. Loopback listener closes after smoke. NOT public SSO audit mount/company login/installed PostgreSQL/provider/deploy acceptance.
- Direct audit-client browser build rejects server-side validator dependencies under existing public-source restrictions. No build bypass/allowlist widening; backend notified for reviewed pure-validator extraction/ownership. Native bridge is explicitly test-only, not a shipped integration solution.
- typecheck, lint (42 existing warnings), planning/link/fixture-secret scan, pinned compatibility and diff checks pass. No new whole-localcheck success claim; exact-head CI/formal approval and dependency gates still required.
