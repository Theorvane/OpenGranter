# Catalog base-price read projection (#641)

1. Preserve authorized list/detail transports and legacy basic rows. No session or write authority is introduced.
2. RED: demonstrate published base prices lost by browser transport. Cover exact decimals, zero, omission, malformed input, unknown fields and foreign IDs.
3. GREEN: optionally project only prompt/completion strings from pricing with existing discovery grammar (128 characters, nonnegative finite decimal/scientific). Reject malformed supplied pricing. Do not calculate costs or apply discounts/overrides.
4. Run focused and management regressions and static checks. Require exact-HEAD formal independent approval and all required CI before merge.

Informational transport only: UI must label published base prices, not actual/discounted costs. No provider calls, session policy, metadata writes or installed acceptance.

## Execution evidence

- RED: 4 tests, 1 passed / 3 failed before production change (missing exact prices, zero, malformed supplied pricing).
- GREEN: 74 catalog regression tests passed, 0 failed, 0 skipped. Includes actual local HTTP sockets for managed/delegated rich discovery, fresh provider Deny, required private audit and no inference/secret/usage calls. Authentication/catalog are test fixtures; not company SSO, installed PostgreSQL or real providers.
- TypeScript, Biome (existing repository warnings only), planning/contract scan, all six pinned schema checks and diff whitespace check passed. Full required CI and independent formal approval are still merge gates.
- Existing SSO catalog publishes basic metadata only; this change does not silently expand that boundary. No browser UI rendering or live endpoint is claimed by this transport PR.
