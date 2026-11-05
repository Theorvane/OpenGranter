# Usage request controls (#642)

## Issue and problem

Issue: #642, parent #637. Operators reviewing an opaque-cursor page can only retry from page one, and cannot explicitly stop an outstanding list or CSV request. Authority lifecycle cancellation already exists but is not an operator control.

## Scope and expected behavior

Add Refresh current page to ready views, preserving exact current query and successful previous-page query history. Add Cancel request while loading or exporting. Cancellation aborts the client, invalidates late completions, clears records/navigation/downloads and shows the existing cancellation message. Retain filters for editing, not data or authority. Retry / first page continues to reset pagination. No automatic retry, billing claims, sessions, runtime mount, schema promotion or deployment.

## Design

Use existing client.invalidate and app revision guard. Refresh refetches through the same authorized transport; retain only query history during the operation. A failed refresh or cancellation clears history as before. No cached historical rows. Authority clear/dispose remains stronger and disconnects the transport. Alternatives: browser reload loses review position; cached refresh would bypass fresh server evaluation. Use fresh reads instead.

Dependencies remain the frontend entry owner and approved listener/schema integration. This change does not settle those decisions. Contracts: contracts/usage-screen.md and contracts/usage-previous-page.md. Update PRD and acceptance with the bounded controls, not installed acceptance.

## TDD plan

1. Add structural DOM regression: second-page refresh forwards unchanged cursor/filters and retains Previous page after success.
2. List cancellation must abort a transport that ignores abort, hide records and discard its late successful completion; reconnect remains usable.
3. CSV cancellation must remove download/records, abort, and ignore late CSV; clear/deny must remain fail-closed.
4. Expected RED: missing Refresh current page and Cancel request buttons. Implement minimal controls, then focused tests, full typecheck/lint, planning checks and npm run check.

## Delivery

Separate #642 branch/worktree based on #705; no edits to frontend entry/transport files. Require exact-head CI and independent formal approval before merge. Rollback is removal of UI controls. Record RED/GREEN and separate structural DOM, real HTTP, unavailable live browser and installed evidence.
