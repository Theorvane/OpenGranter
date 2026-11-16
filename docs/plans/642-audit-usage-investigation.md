# 642 Audit-to-usage request investigation

1. Reuse the validated audit page and existing request-scoped usage API. No new endpoint, IAM permission, session, schema or runtime activation.
2. RED: selecting a request from Audit must load Usage with the exact request ID, clear usage pagination and preserve only Usage applied principal/model/time bounds. Audit targets and unsubmitted drafts must never become Usage authority or query scope.
3. Implement a per-event investigation action using the existing generation guard; show loading, empty and generic failure states. A matching request does not prove provider execution, billing or complete history. Explicit usage targets still require usage:ReadAll; self mode omits principal_id.
4. GREEN: verify transport paths, fresh reads, denied/unavailable/empty outcomes, detached controls and disposal through the public DOM mount; run existing real HTTP JWT/PGlite tests separately. No browser-login or installed acceptance claim.
5. Check TypeScript, changed-file lint, planning links and bounded regressions. Publish a draft PR; require exact-head CI and independent formal GitHub approval before merge. Keep #637 and deployment gates open.

## 2026-11-17 03:30 KST execution evidence

- Recovered only this slice from previous isolated 0230/0300 working copies; originals untouched. Base e37ad55e1dcb012123e55424583f8da1f6368d27 (#949); dependent PR gates remain separate.
- RED: six original DOM cases failed before production change (/tmp/og0330-red.log). GREEN: nine initial cases, then twelve feature cases (nine DOM and three actual HTTP cases).
- Final bounded run: six test files, 40 passed, zero failed/skipped (/tmp/og0330-final.log). NOT full repository tests or npm check.
- HTTP: owned Node listeners, signed synthetic RFC9068 JWT, migrated PGlite, actual IAM/mandatory audit. Scoped success, fresh policy Deny403, failed required audit503. Each test closes listener and SQL.
- Browser: Chromium http://127.0.0.1:35169 titled Local audit investigation acceptance. Initial Usage showed two self requests; Audit showed historical event. Clicking View usage for this request loaded only historical request, one visible attempt, excluding other request/principal. An applied missing-model Usage filter survived a second Audit investigation and rendered empty. Page snapshots and visible desktop confirmed rendering. Paths/statuses: /tmp/og0330-browser.log.
- Browser harness is local test-only, NOT shipped. Server supplies synthetic fixture identity to isolated actual HTTP API. NOT admin login, company IdP session, installed PostgreSQL, ingress/TLS, external user URL, provider acceptance or deployment authorization. Preview is not a durable deployment commitment.
- System node18 rejected strip-types; native Node22.23.4 arm64 used. Initial unrestricted full typecheck resource-killed; final full repository TypeScript check passed with 256MiB V8 heap. Bounded TS7 command required --ignoreConfig then passed. Changed-file Biome, scripts/check.py, diff check passed.
- Shared gh switched to sjungwon03-ai between calls. Corrected/API-verified sjungwon03 before production copy and commit; git author/committer configuration sjungwon03. No secrets printed. Preliminary worktree/doc/test copies happened before correction; no remote write used other identity.
- Exact-head CI and independent formal GitHub approval required before merge; read-only review is NOT approval. Original #637 and login/deployment gates OPEN.
