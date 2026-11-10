# Current-main SSO catalog transport integration

1. Integrate the existing unmerged #688 transport and UI-independent lifecycle into current main without losing published proxy metadata, capability validation, fatal UTF-8 decoding, bounded reads or cancellation. Do not cherry-pick the historical branch wholesale.
2. Keep separately named SSO factories and fixed /management/v1/models paths. Validate existing SSO alias/created/ownership contracts, retain count/user as SSO aliases and reject them only on the compatible proxy client. Never mint credentials, authenticate a browser, bridge SSO to proxy tokens, or activate a session/runtime.
3. RED: restored SSO client/lifecycle and real signed-JWT HTTP integration tests fail because current main lacks the factories. GREEN: restore implementation, run both namespaces, current metadata/capability tests, lifecycle and migrated-PGlite HTTP mandatory audit/revocation checks, typecheck, lint and planning checks.
4. Require exact-head independent formal approval and all required CI. Preserve historical stacked PRs; no company IdP/native-browser/installed PostgreSQL/provider or deployment claim.

## Execution evidence

- Current-main RED: both restored test modules fail to import absent factories (2 failures).
- Integration RED: 4 SSO client tests pass but proxy optional metadata leaks into the SSO basic projection in the new regression (1 failure).
- GREEN: namespace-specific projection retains proxy metadata and strips it from SSO. Focused test totals and final static checks are recorded in the PR.
- Contract: [explicit integration](../../contracts/sso-catalog-client-integration.md). No app/view ownership overlap or session activation.

Final local results: 64/64 focused tests PASS, zero FAIL/SKIP; Node 22 ARM typecheck exit 0; full lint has no errors (existing 42 warnings/155 infos); planning checker, all six pinned schemas and diff whitespace PASS. Full local suite and native browser/company SSO/installed PostgreSQL/provider acceptance were not run.
