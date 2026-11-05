# Usage screen signed-SSO browser acceptance (#637)

1. Preserve frontend ownership of usage-app, entry and session files; stack on #700 exact 31df4b87729f569eb6107aa8b4f15a8512bb96e8. Read #637-643 and original PRD review/self-scope requirements. No session/runtime activation or installed migration.
2. Add an explicit local-only acceptance command, not part of default test discovery. Use real headless Chromium, bundled production usage screen/client, ephemeral signed RFC9068 access token, concrete usage HTTP handler and isolated PGlite. Apply candidate audit schema only to this disposable database. Keep access token in server memory; browser uses a test-only same-origin request port, never a production session bridge.
3. First run without implementation must fail meaningfully. Then exercise actual DOM: ready/unknown values, filter-empty, paging and CSV Blob content, explicit-target denial, fresh IAM revocation, expired JWT, failed durable audit and trusted clear/stale-result suppression. Check audit rows and token/private-data non-disclosure. No paid/provider calls.
4. Use loopback ephemeral ports and a fresh temporary Chromium profile. Close via CDP and dispose server/database/profile. An unavailable browser is a failed explicit acceptance command, not a silent skip. Keep browser dependency separate from standard CI; document command and prerequisites.
5. Run focused existing tests, typecheck, lint and planning/contract checks; commit and PR with exact-head CI and formal review required before merge. Report local browser/PGlite evidence separately from installed PostgreSQL/company SSO acceptance.

## Execution evidence / limitations

- Initial command failed MODULE_NOT_FOUND before the runner existed; this is missing-command RED, not behavior-first UI TDD evidence.
- Initial runner invocation found an unsupported TypeScript parameter property; fixed to an explicit field before typecheck PASS.
- Real desktop observation failed: screen still being released. Independent headless Chromium spawned but produced no DevToolsActivePort within 15 seconds. Acceptance failed explicitly; no screenshot or real browser assertions executed. The unresponsive browser was not killed/restarted and its profile was preserved.
- Focused existing app/client/signed-HTTP integration: 17/17 PASS, zero skips. These are not real Chromium acceptance.
- Runtime/session activation, active migration promotion and production/paid use remain unchanged. Source is DRAFT until actual browser acceptance runs.
