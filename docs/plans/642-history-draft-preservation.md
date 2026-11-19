# Unapplied history filter drafts (#642, #637)

## Issue and problem
The authorized Usage/Audit workspace records draft values only on Apply. Typing a model or principal then switching tabs, refreshing, paging or receiving a pending response clears those edits. Visible inputs can also differ from the applied query without warning.

## Scope and design
Retain input edits separately for each tab within this identity mount. Native input events update only the draft, not the applied filter, network, pagination or CSV scope. Show a live status when edits differ from the applied query. Tab changes and rerenders preserve drafts; Apply uses the existing exact validator and query client; Reset restores the original target. Detached input events cannot write after a render, denial or disposal. Clear private draft/applied state at terminal authentication boundaries. Explicit request drilldowns reset draft scope to the applied request intersection, avoiding stale visible query edits.
No new endpoint, permission, session, runtime, DDL, persistence, retention or activation. In-memory drafts are not saved across identities or reloads. Existing CSV warning remains; draft status explicitly states that displayed records and CSV use applied filters.

## TDD plan
Meaningful RED via public mount: edits survive tab switches and refresh without changing request query; status distinguishes drafts, including blank values; stale input events cannot overwrite current drafts; reset, denial and disposal clear retained inputs; invalid edits issue no request. Cover both tabs, applied principal isolation and request drilldown regressions. Implement the smallest guarded listener and status. Run focused tests, native Chromium, strict TypeScript, lint, planning checks and npm check, recording resource limitations.

## Delivery
Update PRD, architecture, acceptance and contract. Stack only on exact #979; exact-head CI, independent formal approval and parent gates remain required. No production/paid calls or installed/company-SSO/provider acceptance claim. Rollback by reverting this isolated UI change.

## Verification checkpoint
Meaningful RED: 0 pass / 4 fail for missing draft notice and lost pending-response edits. Original request-drilldown behavior RED: 0 pass / 1 fail because unapplied model/principal remained visible instead of the applied intersection. Bounded final nine-suite regression: 91 pass / 0 fail / 0 skip with test-concurrency=1; strict full TypeScript, lint (42 existing warnings/181 infos), document/link/contract/fixture scan, all six offline schema pins and diff checks pass. Native headless Chromium with the production bundle verifies both tabs: drafts survive tab changes and refresh without changing applied query, Enter/mouse single-dispatch, invalid query stays local, Reset restores initial principal, no URL query disclosure and disposal clears DOM. Synthetic loopback JSON is not company SSO, installed PostgreSQL or deployed/provider E2E.

Full npm check reached thousands of tests with test-file SIGKILL failures. Concurrent focused rerun had two additional resource-related failures and TypeScript was killed; stopped only this execution own failed npm check tree, then bounded final regression and TypeScript passed. Full check began before final test edits; no full final-snapshot pass claimed. Exact-head CI and independent formal approval mandatory. Parent #979 inherited the #978 model-detail HTTP wording failure; concurrent repair tree untouched.
