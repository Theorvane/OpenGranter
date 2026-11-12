# Confirmed proxy-token revocation panel

## Issue and problem
- Issue: #640, parent #637. Existing SSO POST revocation has no reusable confirmation panel.

## Scope and expected behavior
- Add an authorized-port client and independently mountable native panel. Two explicit actions precede the sole POST. No automatic replay or optimistic success.
- Reuse existing /management/v1/proxy-tokens/revoke. No new policy, authentication, session, persistence, issuance or secret display. IDs are opaque credential IDs, not bearer tokens.
- Uncertain outcomes never claim success: the mutation may have committed. Abort does not promise rollback.

## Design
- Client validates IDs and exact bounded success envelope, maps safe status outcomes and discards private failures. POST uses no-store, JSON and redirect error.
- Panel uses existing CatalogRequest/CatalogElement structural interfaces, textContent and native buttons; second confirmation, overlap prevention, terminal identity denial and disposable stale-result guards.
- Alternatives: no token-issuance secret exposure or invented session protocol. Frontend owns entry/build/navigation. Reviewed session/runtime URL and browser acceptance remain open dependencies.
- Contract: [token-revocation-panel](../../contracts/token-revocation-panel.md); bounded PRD/architecture/acceptance additions.

## TDD plan
- Public client/panel tests first against unavailable/no-op baseline; assert meaningful failures, not missing modules.
- Test true/false, invalid IDs, authentication/policy/audit errors, malformed/oversized responses, text injection, overlap, stale handlers and disposal.
- Focused public and existing HTTP regressions, full TypeScript/Biome, planning/contracts/links/fixture scans and offline pins. Aggregate resource/toolchain failures are not green evidence.

## Delivery
- Isolated issue branch; record RED/GREEN, PR and exact-head independent review/CI before merge.
- Rollback removes additive panel/client only. No deployed feature is activated by this change.
