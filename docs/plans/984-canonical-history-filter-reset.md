# Canonical history explicit filter reset (#984, #637, #642)

## Scope and ownership
Port existing #723/#719 explicit reset onto canonical history, not legacy composition. Own history-app.ts, new focused test, this plan and append-only history-dom/acceptance docs. No operations shell, backend, session, public entry, runtime, DDL or activation. PR983 summary is separate. Scope posted before edits in issue984; no separate peer ownership confirmation available.

## Contract
Clear filters resets only active usage/audit tab: clear drafts, applied principal/model/request/time filters, cursor history and CSV delivery failure, then load existing protected endpoint with only format=json. Account principal defaults are removable only by explicit action. Tab switches do not clear them. Fresh server IAM still decides scope; never inject identity/grant authority. Inactive tab filters unchanged. Existing load revision cancels prior read/CSV; generation guard rejects detached controls. Reset cannot reacquire authority after denial/disposal. Downloaded files cannot be erased.

## Sequence
1. RED mounted DOM tests: invalid recovery, fresh page/cursor, per-tab independence, pending CSV/read cancellation, stale controls, delivery-error recovery, terminal boundaries.
2. GREEN: existing guarded button calls review.load({}) after clearing active draft/filter/delivery state. No new transport/state machine.
3. Focused canonical/operations/browser-build regression, typecheck, lint, planning, compatibility/full check. Native browser evidence distinct from installed login/PostgreSQL/provider acceptance.
4. Draft PR; independent review, exact HEAD mandatory CI, formal independent approval and parent gates before merge.

Original PRD/browser login/session/installed release/E2E remain open. This is not full #723 supersession.

## Execution evidence (2026-11-21 23:00 KST run)

RED 0 pass/6 fail (missing Clear filters); GREEN 7 focused reset tests, final five-suite regression 63 pass/0 fail/0 skip including actual browser build boundary. Lint/planning/fixture-secret scan/compatibility pass. Standalone typecheck exited Killed without compiler diagnostic; cause not established. Full npm run check not certified or re-run past this blocker. Browser tool timed out; desktop observed old18742 tab Aw Snap error9. New18743 harness attempts left no listening process or diagnostic; no new native-browser reset verification claimed. No installed login, IdP, PostgreSQL, provider or deployment acceptance. Logs /tmp/og-984-2300-*; exact SHA recorded in PR/handoff after commit.

## 2026-11-22 00:00 KST CI repair
Prior14614a9 CI Checks failed with TS2345 at test118 (unchecked array element) and TS2322 at220/251 (nullable RequestInit.signal). Added explicit path assertion and normalized optional signal observations with nullish undefined. Production handler unchanged. Standalone typecheck passes; four serial canonical suites51PASS0FAIL0SKIP; changed-test Biome and diffcheck pass. Logs /tmp/og-985-0000-{typecheck2,focused}.log. Not aggregate fullcheck or installed acceptance.
Duplicate PR987 exact10910f8 implements the same ten-line reset handler (comments differ), found from actual diff after stale2230 handoff. Keep both unmerged pending independent consolidation review; do not merge both or assume all PR723 gaps resolved. PR983 summary remains separate.
