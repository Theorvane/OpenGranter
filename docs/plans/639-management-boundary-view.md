# Management boundary view (R1.1 presentation sub-slice)

## Issue and problem

Refs #639, parent #637. There is no TypeScript management UI. First implement non-content presentation states for identity loading, absent, expired, denied and unavailable.

## Scope and expected behavior

Pure TypeScript renderer returns a complete accessible HTML document with fixed text. No principal, error detail, token, URL or arbitrary content is accepted or echoed. Unknown states render unavailable. All states omit protected navigation/content. This is a presentation primitive, NOT authentication, an installed UI or completed R1.

No HTTP endpoint, listener, browser storage, OIDC behavior, login/logout controls, permissions, network, persistence, audit or provider calls. Later reviewed integration must translate trusted session results and remove protected content immediately on expiry/denial. UI never authorizes API access.

## Design

Allowlisted states and fixed HTML avoid choosing a framework or session transport. Loading uses a polite status, failures an alert. Include language, viewport, title and main landmark. Do not invent authenticated/ready contracts or working login links.

Session/BFF versus bearer, OIDC, CSRF/CORS, listener lifecycle, current-principal and scoped navigation remain unresolved in the [inventory](../product-traceability.md). This slice settles none and closes neither #638 nor #639.

## TDD plan

Write public renderer tests first: distinct state copy, accessible landmarks/status, absence of active links/forms/scripts/protected content, malformed inputs never reflected. Run RED against an unavailable-only stub, then implement fixed-state rendering. Run focused tests, typecheck/lint, planning checker and full npm run check; record resource failures honestly.

## Delivery

Separate issue branch and exact-head review/CI. Rollback removes an unused module; gateway startup is unchanged. Browser/session integration and browser journeys remain follow-up work behind approved contracts. Report renderer coverage only, not browser login acceptance.

## Execution evidence

RED: focused tests against unavailable-only stub: 7 tests, 5 failed on required HTML/state assertions. GREEN: same command after implementation: 7 passed. Focused TypeScript strict checking and repository lint pass (existing warnings/information retained). Planning checker and diff checks pass. Full npm run check exits 137 with Killed during typecheck on this machine; full local typecheck/test/compatibility success is NOT claimed. Exact-head CI remains a merge gate. No installed listener, Docker, browser login or live-provider acceptance executed.
