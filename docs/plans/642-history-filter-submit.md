# Keyboard history filter submission (#642, #637)

## Issue and problem
Usage and Audit filters currently use a section and a type=button control. Native Enter in an input does not apply filters. This blocks keyboard-first operation of the existing admin history vertical slice.

## Scope and design
Use a named native form and submit button. Prevent default navigation for both button click and form submit; route both through the existing filter parser and authorized client exactly once. Preserve generation/disposal/denial guards, exact principal/model/request identifiers, invalid-query rejection, cancellation and page reset. Native validation must not override the existing query validator. Other buttons remain type=button. No new API, authority, session, runtime, DDL or deployment activation. The event port gains only optional preventDefault; existing zero-argument test/host ports remain valid.

## TDD
Reproduce missing form submission through both public tabs. Cover exact Unicode fields, invalid numeric input (no network), stale form after rerender/disposal and fresh denial. Verify native Enter and mouse click each dispatch one request without URL navigation. Keep private input out of the document URL.

## Delivery and gates
Update PRD/acceptance/contract. Run focused history, catalog and operations tests, browser build, strict typecheck, lint, document checker and full check. Report resource failures honestly. Stack on draft978 without ready/auto promotion; exact-head CI, independent formal approval and complete parents required. Synthetic browser HTTP is not company SSO, installed PostgreSQL or provider E2E. No production or paid calls.

## Verification checkpoint
Meaningful RED under Node22: 0 pass / 2 fail because the native named form is absent. An initial test incorrectly used a Unicode request ID; corrected to the existing ASCII request-ID contract, preserving Unicode model coverage. GREEN mount/filter/cancellation suites: 42/42, zero skip. Additional workspace/catalog/account-operation suites: 37/37; operations/session/browser-build suites: 62/62, zero skip. Full strict TypeScript passes. Native Chromium headless exercises Enter and mouse single-dispatch for both Usage and Audit over synthetic loopback JSON, exact Unicode model/ASCII request/principal scope, invalid page size without network, no page navigation/query disclosure, scoped reset and disposal. This is not actual SSO or installed/provider E2E. Full check started separately; test processes show resource SIGKILL, so no full check pass claimed. Independent exact-head review and CI remain required.

## Parent recovery integration (2026-11-19 11:30 KST)
Merge parent978 exact32bfde53 to inherit the Account-scoped initialization retry fix and canonical model HTTP assertion. Preserve both keyboard-form and parent recovery checkpoints in append-only documentation conflicts. No native submission behavior changes. Fresh exact-head CI/review still required.
