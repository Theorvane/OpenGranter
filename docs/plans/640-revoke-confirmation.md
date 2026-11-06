# Explicit proxy-token revocation review (#640)

1. Preserve existing token mutation API, IAM, fresh server checks, transaction and mandatory audit. Add a local confirmation step to the existing credential screen only. No login/session, runtime or reconciliation policy changes.
2. Before production edits, write source/bundle RED cases for zero-dispatch review, exact submitted ID, cancel, duplicate/stale controls and authority invalidation. Extend existing signed-JWT HTTP/PGlite integration assertions rather than claim fixtures are installed acceptance.
3. Review displays the exact submitted credential ID with textContent, never ownership or active-status claims. Confirmation dispatches that snapshot only; input edits cannot retarget it. Cancel, any workspace notification, issue action, renewal, expiry, logout and disposal invalidate it. No automatic retry.
4. Run focused screen/host/client/authority/workspace and actual loopback HTTP tests, typecheck, lint, planning and compatibility checks. Record meaningful RED/GREEN evidence; no redundant full-suite loop.
5. Submit a stacked PR with exact HEAD independent review and required CI. Merge only after valid formal approval and all required ancestor/head checks. Source/artifact structural DOM and local signed-JWT/PGlite HTTP are not native-browser login or installed PostgreSQL. Production and paid calls remain gated.
