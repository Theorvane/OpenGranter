# Restore the reviewed usage framing candidate to the UI stack (#637, #642)

## Issue and problem
1. Current UI candidate PR952 e13f55f does not contain independent PR927 df7f26c. The bodyless Usage GET guard therefore remains absent on that candidate, despite already implemented source and green CI on the separate branch. Do not duplicate the patch or claim a new defect implementation.

## Scope and expected behavior
2. Merge the existing PR927 commit into a new branch based on PR952, preserving both histories and all unrelated worktrees. Reject nonzero/ambiguous Content-Length and Transfer-Encoding before history access; valid absent/exact-zero framing retains fresh authentication, IAM and mandatory audit. No new session, CSRF, policy, schema, runtime, deployment or paid-call authority.

## Design
3. Use an explicit merge rather than copying source/cherry-picking a duplicate fix. Retain the original tests and plan at docs/plans/642-usage-get-framing.md and contracts/sso-usage-history.md. Original PRD and acceptance bodyless-read requirements remain unchanged. Existing PR952 dependencies and PR927 must satisfy review gates before ordered merge. Login draft selection is still unresolved.

## TDD plan
4. RED on PR952: assert a malformed GET returns400 with zero history calls. Existing reproduction returned200 and invoked history. Merge only after recording the failing assertion. GREEN: same assertion plus original signed-synthetic-JWT/PGlite usage HTTP tests and browser/catalog regression; full TypeScript, changed lint and planning checks. This is integration of an existing production fix, not new fixture behavior.

## Delivery
5. Record exact merged revision, commands and outcomes. Open a stacked PR targeting PR952 and request independent exact-head review. No merge until required exact-head CI and valid independent formal approval for all dependencies. Rollback by dropping this integration branch, not altering existing worktrees. Local synthetic/embedded results are not admin login, installed PostgreSQL/TLS, a user deployment URL or provider E2E.

## Local evidence (2026-11-17 10:30 KST execution)
6. RED assertion on PR952 returned200 versus required400 (/tmp/og1030-framing-red.log). Merged existing df7f26c; resolved PRD append conflict by retaining both sections and test conflict by retaining current request-filter coverage plus both original framing tests/imports/fixture handler. No original test was deleted.
7. GREEN: 11/11 signed-synthetic-JWT + migrated PGlite Usage Fetch/actual Node HTTP tests, zero skips (/tmp/og1030-usage-green.log). Additional catalog app/SSO client/public static browser HTTP regressions:21/21, zero skips (/tmp/og1030-regression.log). Full TypeScript log empty, changed-file Biome, scripts/check.py, whitespace checks pass. No full local npm-check or installed/browser-login/provider success claim. CI and formal approval pending.
