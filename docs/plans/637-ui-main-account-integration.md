# Integrate reviewed Account into the current UI candidate (#637)

## Problem and scope
PR978 contains the latest UI history, Models and operations work, but predates reviewed main Account response integrity. Integrate actual main rather than duplicating production logic. CI exposed a stale PostgreSQL/HTTP DOM assertion after adopting the canonical model-detail renderer.

## Contract and acceptance
Preserve exact published prices, plain-text metadata, fresh IAM, signed JWT validation and mandatory durable audit. Published base prices are not estimated or billed request costs. Keep refresh, revocation, denied and empty behavior. No session, runtime, DDL, authority, policy or activation expansion.

## Implementation and verification
1. RED: CI44426455525 actual PostgreSQL/HTTP DOM test expects not billed costs while canonical DOM says not estimated or billed request costs. Preserve private-data and authorization checks.
2. Merge actual main containing independently approved PR945 into existing draft978. Preserve both slices in documentation append conflicts.
3. Update only stale equivalent-text expectation. Run focused real Node HTTP and embedded PostgreSQL test, model display/browser build, lint and planning checks. Attempt full check; report resource failures honestly.
4. Execute visible local browser checks on compiled UI; distinguish disconnected demo from authenticated/installed acceptance.
5. Update existing draft978; request fresh independent exact-head review. Retain parent976/946 and934 gates; no implicit ready, auto-merge or deployment.

## Risks and rollback
Squashed ancestry may cause documentation conflicts. Preserve both histories. Roll back candidate commit, not other worktrees. Local embedded SQL or preview is not native PostgreSQL, SSO login, public deployment or provider E2E.

## Account-scoped history adapter recovery
During integration, the retry callback for failed download-adapter initialization was found to discard the captured Account principal. This contradicts contracts/account-history-navigation.md: recovery must not silently fall back to an unfiltered/self request. Before production editing, add a regression that fails when the retry loses the exact target, including unsupported identifiers and server denial/unavailability. Then retain the captured principal only for the current epoch-bound retry; explicit manual History navigation still clears the default. No new authority or authentication contract.

## Execution evidence (2026-11-19 11:30 KST)
- Integrated main faf607c8, retaining later account-target token preparation, UTC expiry wording, invalid revocation handling and pagehide cleanup in seven source/test/documentation conflicts. Main source code was already present; no claim of newly implementing Account integrity.
- Scoped adapter recovery regression RED: 0 pass / 4 fail because retry dropped principal_id (invalid target incorrectly sent self request). Minimal epoch-bound callback fix; related four suites GREEN 37 pass / 0 fail / 0 skip including signed JWT, Node HTTP and embedded SQL account history acceptance.
- Separate six-suite parent regression: 43 pass / 0 fail / 0 skip including full model HTTP suite, Account, issued-token handoff, UTC expiry and pagehide.
- Full strict TypeScript and full lint pass (42 existing warnings / 181 infos), planning/link/fixture scan and six offline compatibility pins pass. Native Chromium production bundle with synthetic loopback JSON passes exact target 200/403/503 and invalid-ID recovery, manual navigation reset and disposal. Initial browser harness expected an incorrect period in Access denied; corrected harness only after inspecting canonical boundary text, then all four scenarios passed.
- Full npm check started in background /tmp/og-191130-fullcheck.log; do not imply full success before completion. Native screenshot /tmp/og-191130-account-history-recovery.png. Not company SSO/login, installed PostgreSQL/TLS, deployed operator URL or provider E2E. No runtime/session/DDL/activation changes.
