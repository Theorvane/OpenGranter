# Published model capability filters (#641)

## Issue and problem
Issue #641, parent #637. Model details expose published modalities and parameters, but administrators cannot narrow the authorized list by these properties.

## Scope and expected behavior
Add exact input modality, output modality and supported parameter selectors that intersect existing text search. Options come only from the current authorized publication, preserve exact future labels, and exclude unknown metadata for an active selection. Empty selection means no restriction. Filtering is local, not routing, policy simulation, provider capability verification or administration writes.

## Design
A pure publication filter supplies exact options and intersection matching. The native catalog view owns controls within its current render. No session, entry, navigation, authority, API, storage, routing or billing changes. Existing teardown must make detached controls inert and clear input values, including prior search. No new security decisions are made. See contracts/catalog-publication-filters.md.

## TDD plan
First render the current list and assert selectors exist: expected RED missing selectors. Then intersection/search, unknown/empty metadata, exact Unicode/future labels, no-match/reset, safe text, detail navigation and detached-control teardown. Run catalog DOM/client/session and loopback authorization regressions, typecheck, lint and npm run check; disclose incomplete checks.

## Delivery
Dependency-stacked PR with exact-head CI and independent formal approval required. Rollback removes local selectors only. No installed/browser SSO/live provider or product completion claim.

## Execution evidence (2026-11-17)
- Before production change, 3/3 new DOM tests failed on missing published selectors.
- After implementation, 43/43 focused DOM, session, client, SSO-adapter and loopback HTTP tests passed with zero skips. Loopback selection sends no fetch; detail and refresh reevaluate a new provider Deny and append required read audits.
- Native Chromium local demo confirmed 3 models to 1 image/tools match, conflicting audio output to no-match, then Deny clears all catalog controls. This uses synthetic rows, no installed API or login.
- Native full typecheck, changed-file Biome, document checker, diff check and pinned compatibility checker passed. npm run check initially unavailable on default PATH; full native-toolchain check launched separately, outcome pending at PR creation.
- No merge or activation; exact-head CI and independent approval remain gates.
