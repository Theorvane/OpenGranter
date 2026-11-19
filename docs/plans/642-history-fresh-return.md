# Fresh history page re-entry (#642)

1. Reuse existing review.retry exact-page transport; no new authority, polling or endpoints.
2. Changing to a loaded tab synchronously clears prior rows and freshly GETs applied filters/current cursor; never render stale target rows before loading. Preserve invalid-filter state and coalesce in-flight tab reads.
3. Add explicit Refresh current page for ready/empty pages using applied filters, not unsubmitted drafts. Fresh 401/403 clears both histories through existing boundaries.
4. Establish RED/GREEN DOM integration, exact opaque cursor and owned HTTP/embedded PostgreSQL revocation tests. Distinguish synthetic SSO from installed/company login.
5. Run focused tests/typecheck/lint/scripts/pins; publish dependent PR and request exact-HEAD review. No merge without required CI and independent formal approval.

No session acquisition, new grants/schema/retention, public activation, deployment or paid calls. Existing usage-record worktree untouched.

## Main integration — 2026-11-19 06:30 KST

Merged main f9442fbb74f9f277512fccdfd02e80478fb5b7e9 into the existing PR942 candidate, resolving 24 conflicting documentation/test files against the already integrated cdd5206 checkpoint and restoring all PR918 initialization-recovery contracts/tests from main. The resulting delta from main is limited to fresh history re-entry and refresh, with canonical Account navigation and retry unchanged. No duplicate PR, new session contract, schema or activation.

Actual integrated tree: four DOM/operations/session test files 71/71 pass, zero skipped; repository lint passes with 42 warnings/181 infos; scripts/check.py passes. Owned HTTP/embedded PostgreSQL test was SIGKILLed, including one capped isolated correction; no new HTTP pass claimed. Full check stops at resource-killed typecheck, including one capped correction. Prior HTTP/browser evidence belongs to the earlier candidate, not this integration. Exact-HEAD CI and a fresh independent formal approval remain mandatory; no installed/company-SSO/provider acceptance is inferred.
