# Shared usage browser contracts (#642)

1. Unblock the canonical management usage review bundle: its JSON projection currently imports server-oriented history code outside the public-source build boundary.
2. Move the existing pure row validation, record normalization, attribution validation, exact decimal comparison and JSON projection into one reviewed shared usage closure; preserve old server module exports and error class identity. No schema duplication or relaxed validation.
3. Permit only these five named shared source files as transitive dependencies; the entry must remain within management. Reject other shared/server files, externals and symlink escapes. Audit review extraction remains separate.
4. First demonstrate actual usage-client and usage-review build failures, then bundle and execute their public API against controlled JSON/CSV responses. Cover cost precision, unknown usage, field projection, invalid rows, cancellation and safe failures.
5. No UI navigation/session/CSRF/IdP/IAM/database/provider/default activation changes. FE retains entry/DOM ownership. This is a build/integration prerequisite, not browser login or deployment acceptance.
6. Run selected regressions, full typecheck/lint and repository checks. Require exact-head full CI and formal independent approval before merge. Rollback by reverting the shared imports and builder permission together.

Contract: [shared usage browser contracts](../../contracts/shared-usage-browser-contracts.md). Product: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md).

7. Serve the exact canonical artifact from the owned management runtime; execute its compiled coordinator through real loopback HTTP, signed synthetic JWT, migrated embedded SQL, JSON/CSV paging, durable access audit failure and fresh Deny. This remains local artifact/API integration, not company IdP or native-browser certification.

## Recorded evidence

- Before implementation, three build/integration tests failed because the actual usage closure was outside the public source boundary. After extraction, all passed; compatibility-identity coverage was then added.
- Final selected regression: 110/110 pass, zero skipped. Includes compiled coordinator served by the actual owned loopback management runtime, synthetic signed JWT, migrated PGlite, paging, CSV, mandatory durable audit failure and fresh Deny.
- Full typecheck passed; full Biome had no errors (42 inherited warnings, 174 infos); planning/contracts/links/fixture scan and six offline schema pins passed.
- Initial broader build regression had 66 pass and one existing npm-publication failure: npm cannot be spawned in this local environment. npm run check could not start because npm was not found. These are not aggregate-green results; CI must provide the full required gate. No dependency repair or skipped-test rewrite.
- The first additional runtime test incorrectly applied migrations before the runtime-owned migration ledger; startup correctly failed. Test setup was corrected to let the owned runtime migrate once, without production changes.
- Native Chromium remains unavailable (existing Aw Snap Error 9); built-module HTTP execution does not certify native browser rendering or company login.

## Review follow-up: canonical checkout roots

- Reproduce the formal review failure using a symlink to the actual checkout and the actual usage-review entry, then canonicalize the checkout root before constructing the fixed shared allowlist.
- Prove both direct and symlink-root builds produce identical runnable artifacts; retain rejection of shared entries, non-reviewed imports and allowlisted-file symlink escapes through either root. No additional source permissions or session/runtime changes.
- RED: actual symlink-root usage-review regression failed as expected (4 pass, 1 fail, zero skipped). GREEN: canonical build/artifact/owned HTTP runtime selection passed 8/8, zero skipped. Full typecheck and planning checks passed. Broader build selection remains 15 pass / 1 npm-publication environment failure; discovered npm launcher fails on missing walk-up-path, so full npm check remains blocked locally. No test skip or toolchain repair.
