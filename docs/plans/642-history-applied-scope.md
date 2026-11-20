# Applied history query scope (#642, #637)

## Issue and problem
Administrators can edit filters without applying them. The current form is not a reliable account of the scope used by visible records and current-page CSV, especially across request drilldowns and target-principal mounts.

## Scope and expected behavior
Display a read-only labelled summary for ready/empty authorized pages only. Include principal mode (signed-in principal or exact explicit target), model, request ID, inclusive/exclusive UTC bounds and page-size setting. Omitted bounds are not invented; a default page-size setting is not the number returned. This describes query restrictions, not effective permissions, complete history or invoice totals. No new API, authority, session/runtime/DDL, retention or activation.

## Design
Render from the applied per-view filters, never from mutable input drafts or returned row values. Do not show a summary during loading, invalid queries, failed/cancelled reads, denial or disposal. Existing fresh IAM, cancellation, cursor and CSV controls remain authoritative. Existing server readers explicitly default omitted principal to the signed-in principal. No unresolved policy decision is settled. See contracts/history-applied-scope.md and PRD/architecture/acceptance additions.

## TDD plan
Public mount tests fail first for absent summary on both tabs. Cover self/explicit principal, empty pages, Unicode/literal unsafe markup, exact UTC bounds and page size, draft edits/CSV, refresh loading/failure/retry, tab isolation, reset target restoration, terminal denial and disposal. Then add presentation-only implementation and run focused serial suites, strict typecheck/lint/docs/compatibility/build, native browser checks and full check.

## Delivery
Extend existing unmerged draft #980 without touching other owners files or widening contracts. Exact-head CI, independent formal approval and parent dependency gates remain required. Rollback removes only presentation. Local synthetic tests are not deployed/company IdP/PostgreSQL/provider acceptance.

## Verification
Initial RED: 0/4 pass because the public summary was absent. Initial explicit principal fixture was invalid and was corrected to a canonical identifier, without changing production validation. Final focused serial suites: 72/72 PASS, zero skip, including signed synthetic JWT + migrated PGlite + real loopback HTTP/SQL pagination/CSV/read-audit/fresh Deny and explicit applied-scope assertions. Native Chromium production-bundle checks pass for Usage/Audit, self/explicit-target, UTC bounds, literal markup, draft/CSV separation, failure/retry/Deny/disposal. Strict full typecheck, lint (42 pre-existing warnings), planning/link/fixture scan, offline compatibility pins and history browser bundle pass.

Full npm run check could not execute: the system npm entry is absent and the cached Node22 npm tree is incomplete (missing walk-up-path). Direct full serial test execution also encountered worker SIGKILL; no full-check pass is claimed. Its verified own runner was stopped; a concurrent isolated HTTP run was resource-killed, then passed serially after cleanup. No browser/display process was targeted. Final changed-test serial rerun: 6/6 PASS. Synthetic local evidence does not certify company IdP, installed native PostgreSQL, deployed browser or provider acceptance.
