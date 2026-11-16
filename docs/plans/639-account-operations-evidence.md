# Account operations integration evidence — 2026-11-16 17:00 KST

## Scope and provenance

Completed the uncommitted 16:00 integration in a separate worktree based on PR939 (5241871). Original worktree and its changes remain untouched. Only the inner operations workspace changes: canonical Account alongside existing History and Proxy tokens. Default History, outer Models ownership and public entry are unchanged. This consumes an already-trusted caller request, not a new login or permission contract.

## RED and GREEN

- Before applying the operations integration, five lifecycle cases failed because Account navigation was absent: /tmp/og1700-red.log (0 pass, 5 fail).
- After applying integration: seven serial files, 61 pass, 0 fail, 0 skip: /tmp/og1700-regression.log. Includes actual owned HTTP with signed synthetic RFC9068 JWT and embedded PostgreSQL.
- Actual HTTP scenario: History empty → audited Account identity → mandatory audit table outage hides identity and reports unavailable → audit restored and Retry succeeds → History clears Account → Account re-fetches → IAM human deactivation makes Refresh return 401 and locks the complete workspace. Four durable Account audit rows; failed-audit attempt publishes no identity.
- Unit cases cover stale controls, navigation disposal, 401/403 lock, logout cancellation, replacement identity, and late streamed identity past deadline with a missed timer.
- Full repository tsc --noEmit completed exit 0 with managed Node22 and 384MB cap: /tmp/og1700-tsc.log. This is not a full repository test run.
- Biome changed four TypeScript files passed; scripts/check.py passed; six pinned schema checks passed; git diff --check passed.

## Real browser, not installed acceptance

A temporary local harness built src/management/operations-session.ts through buildManagementBrowser and served http://127.0.0.1:18857/. The signed synthetic JWT stayed server-side. Browser page tools verified History empty → Account / account-human / human → History without identity → Proxy tokens forms without submitting → Account → deactivate synthetic identity → Refresh → Sign-in required with no workspace or identity. No token mutation or provider request was made. The harness is local and ephemeral, not a user-accessible deployment URL.

## Remaining gates

This does not establish company SSO login/logout, approved BFF/CSRF/IdP/TLS, installed PostgreSQL, migrations, external user access, provider or paid E2E. PR786 remains an unapproved proposal. Merge requires dependency-first exact-HEAD required CI and valid independent formal GitHub approval. Read-only bot review is not that approval. Whole PRD and operator handoff remain open.
