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
