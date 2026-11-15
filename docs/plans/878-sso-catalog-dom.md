# 878: Explicit SSO catalog DOM composition

## Scope
Connect the reviewed SSO catalog authority to the management view through a separately named trusted mount. Parent #637, #639 and #641. No browser session, authentication, BFF, automatic entry activation, credentials, new routes or IAM expansion. Public entry and proxy mount remain unchanged.

## Ordered implementation
1. Add contract tests for an inert mount and trusted SSO list/detail/back navigation, SSO-valid count/user aliases, loading and no proxy fallback.
2. Capture RED against the missing export.
3. Share the existing DOM coordinator internally and export mountSsoManagementCatalog with the existing SSO authority. Keep mountManagementCatalog unchanged in behavior.
4. Verify empty/error/authentication loss and clear/disposal suppress private and late data. Run proxy/SSO authority, session, view and app regressions, typecheck, lint and planning checks.
5. Require independent formal exact-head approval and all required CI before merge.

## Evidence boundary
DOM ports and test-JWT/PGlite loopback tests are local only, not company browser login, installed PostgreSQL, live providers or deployment. Session/CSRF/IdP contracts remain separate gates.

## Local execution evidence
Node v22.23.4 RED: the new SSO mount export was absent (after correcting an unsupported test parameter-property syntax). GREEN: 227/227 tests, zero skipped, covering proxy/SSO apps, views, clients, sessions, authorities and existing signed-test-JWT/PGlite loopback HTTP composition. Full TypeScript and planning/pin checks pass; Biome reports existing repository diagnostics but no errors. The 02:30 full-suite run on the previous HEAD was not GREEN: 9237 passed, 21 failed, one cancelled, one skipped; logs include SIGKILL/resource failures and an unavailable local npm executable. This is not replaced by targeted success; hosted CI remains a separate gate.
