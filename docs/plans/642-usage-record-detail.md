# Scoped usage record detail (#642)

1. Reuse authorized usage page records, existing validated projection and exact decimal comparison; no fetch or permissions added.
2. Add collapsed native details for attempt/credential/route/provider, partial counters, recorded policy/price versions and cost source. Unknown remains Unknown; zero stays zero. Never serialize raw extras.
3. Require RED/GREEN for list integration, unsafe extras, historical provenance, partial/missing/invalid counters, mismatched currencies and malformed data.
4. Verify owned HTTP + embedded PostgreSQL path and Chromium separately; no company SSO, installation or paid-call claim. Loading/denial/disposal must erase details.
5. Commit/PR under sjungwon03; exact-head CI and valid independent formal approval required before merge.

Adopts unfinished renderer/tests from preserved 18:00 worktree through preserved 19:00 worktree into isolated 19:30 worktree; original worktree unchanged. Base PR942.

## 2026-11-19 main integration

Parent PR942 merged as cf5f1a0e757bb8bfc9a06e658a798e71819cbe0c. Integrate this implementation into current main, resolving 25 stale stack conflicts in favor of reviewed main and retaining the seven-file usage-detail slice. Existing initialization retry, Account navigation and fresh authority lifecycle are unchanged.

Reproduced meaningful integration RED by temporarily removing the detail append: one focused test fails because the usage record details are absent. Restoring the integration gives 10/10 renderer/integration PASS; six-file DOM/session/navigation regression set gives 81/81 PASS, zero skipped. Full lint PASS (42 warnings, 181 infos), planning/contract/secret scan PASS and six pinned offline compatibility checks PASS; diff check PASS.

Owned HTTP embedded-PostgreSQL test was SIGKILL under capped resources. Required npm run check attempted with Node128 and Go runtime caps, but typecheck was Killed. No unchanged resource retries. Browser CDP unavailable; desktop observe shows empty workspace. Historical browser and HTTP evidence above is not a fresh acceptance of this integrated tree. No installed database, company SSO, external access URL or paid provider acceptance claimed. Fresh exact-HEAD CI and independent formal approval required before merge.
