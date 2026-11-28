# Canonical current-page cost summary

## Issue and problem
Refs #982, #637, #642 and historical #723. Canonical history has exact per-record costs but omits the historical current-page cost/coverage summary. Do not reintroduce removed legacy review handlers or UI composition.

## Scope and expected behavior
Only the active ready usage page receives a cost summary. Sum validated estimate and reported decimals independently per currency with bigint scaled decimals, never Number money or currency conversion. Show coverage, unknown usage states, possibly billed and duplicate counts. Include duplicates, explicitly label page-only/not invoice. Missing amounts remain Unknown, explicit zero stays zero. No additional API calls, authority, session/runtime/DDL, public entry activation, pricing or accounting writes.

## Design
Port the existing historical usage-page-summary algorithm from #723 c12701ec3d9542d82b7465ed75ec91532c33ce90 to CatalogElement and integrate at the canonical history ready render. Own only src/management/usage-page-summary.ts, the summary import/render in history-app.ts, a new dedicated test, and this plan/contract/acceptance append. Preserve frontend shell/entry and backend ports. Worktree /tmp/og-982-20261121-2230. No new domain/security decisions; existing page-summary semantics are retained. Unlike old UI, empty pages show existing empty state rather than a synthetic total.

## TDD plan
1. Regress canonical mount: exact large/fractional per-currency totals, distinct estimate/report coverage, zero/missing, duplicate warnings, only one request.
2. Exercise loading, next page, empty, error, audit navigation, denial and disposal: no previous summary may remain in current DOM.
3. Run RED before port. Port only summary and ready-render integration, then GREEN. Run focused history/operations suites, typecheck/lint/planning/compatibility and standard full check, reporting resource failures truthfully.

## Delivery and risks
Publish issue-numbered PR based on current main with exact SHA and separate evidence. Independent exact-head formal approval and required CI before merge. Bigint assumes existing validated bounded decimal strings; no unvalidated input API is added. Rollback is removing summary import/render and helper. Unit/structural DOM evidence is not native browser login, installed release, IdP or provider acceptance. Original #637 completion gates remain open.

## Execution evidence (2026-11-21 KST)

RED: 0/5; GREEN: 5/5, then final six focused suites 90 PASS / 0 FAIL / 0 SKIP including browser build. Whole lint, planning/fixture-secret scan, compatibility and diff check PASS. Initial typecheck PASS; standard fullcheck and final typecheck terminated Killed without diagnostics (cause unproven), so final full local check is NOT passed. Native loopback browser with actual gateway, migrated PGlite and synthetic signed SSO displayed exact large decimal/unknown coverage; Audit and empty filters removed summary. Explicit harness authority is not login, installed release or real provider evidence. CI and independent formal approval remain required.
