# Canonical history CSV delivery alert lifecycle

## Issue and problem
Issue #998; original #637/#642. A failed browser download leaves a generic CSV alert after a fresh JSON query has retired that export. Existing Clear filters resets it, but refresh, apply and tab return do not.

## Scope and expected behavior
Reset the active tab delivery-failure flag when its review enters loading. Local draft edits and Discard filter edits do not retire the export and must preserve the alert. Both Usage and Audit share the behavior. Keep generic failures, denial teardown, download ownership and independent server authorization unchanged.

No new session/runtime/DDL/activation, API, storage, provider or deployment behavior. Parent draft #997 exact1b39e7ea8dbb37db6eb611d4cf1b039edb6166ae. Own only the loading-state reset in history-app.ts, new regression test and contract/plan append; no competing edits observed. No new domain decisions.

## Design and TDD
Add public-mount tests reproducing failure after fresh refresh/apply/tab return, asserting loading and completion, both adapter unavailable and thrown failure; preserve alert for local edits/discard, protect denial/disposal and retired controls. RED before production change. Smallest fix is a loading-state reset at the canonical render boundary, not clearing every render or changing review/client authorization. Contract: contracts/management-history-workspace.md. Run focused regressions, lint, planning and standard npm run check; distinguish CI from installed E2E.

## Delivery and rollback
Independent exact-head approval, required CI and parent chain remain mandatory. Remove the reset to roll back; no migration. Capture browser verification separately. Full PRD and installed login/IdP/PostgreSQL/provider acceptance remain incomplete.

## Verification checkpoint (2026-11-23 09:30 KST)
Recovered existing issue branch and uncommitted production/test work without overwriting it. Inherited RED /tmp/og-0800-998-red.log: 4 pass, 6 expected failures (stale delivery alert). Current Node22.23.4 arm64 focused run /tmp/og-0930-998-focused-arm.log: 36 pass, 0 fail, 0 skip including existing history-app regressions. Changed-file Biome (3 files), planning/links/contracts/fixture secret scan and six pinned compatibility schemas pass. Diff check passes. Initial x64 tool invocation could not load on arm64; corrected to native arm64. Direct Node compatibility invocation used because native npm executable lacked permission.

Inherited standard npm run check /tmp/og-0630-998-fullcheck.log exited137 at typecheck (Killed); downstream stages did not run. Full local check is not successful. CI and exact-head independent approval remain pending. No installed/browser login/E2E or deployment acceptance is asserted. Parent #997 and ancestry remain draft/unmerged.
