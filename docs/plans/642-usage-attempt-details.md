# Usage attempt detail inspection (#642)

1. Add a regression for per-row expandable content-free attempt metadata, exact cost strings and Unknown values. Run it before implementation and retain the behavioral failure.
2. Render native details/summary within the existing authorized usage row; use only textContent, no additional request, no tokens or credential identifiers.
3. Include request/attempt IDs, route/model/provider, latency, token breakdown, estimated price version and reported billing source. Preserve unknowns without reconciliation or billing inference.
4. Verify detail removal on loading, denied/expired/clear/dispose and independence across rows using structural DOM tests; run focused HTTP tests, typecheck and lint. Real-browser acceptance remains separate.
5. Open a stacked PR against the usage screen, request independent exact-head review and require full CI plus formal approval before merge. Do not activate session, schema, listener or deployment.

## Current canonical history integration (2026-11-15)

Reuse PR702 (4c29dfddf0e40b24ac39816a31a92e02638f1c76) renderer rather than create a second implementation. Change its type-only imports to the current browser-safe shared UsageRecord and CatalogElement; add recorded outcome. Integrate in canonical history-app, not the unmerged legacy usage-app chain. Request cross-PR overlap review; preserve legacy702 until ownership/retirement is resolved. No forced branch update.

# Usage attempt details (#642)

1. Reuse the authorized JSON history publication; do not add endpoints, policy, credentials or provider calls. Original PRD sections 1/3 require attribution through the selected route.
2. Add collapsed native details to each usage row for attempt ID, route kind, upstream model, selected candidate, reported actual provider, outcome, latency and prompt/completion token counts. Unknown is not zero or an inferred provider.
3. Only known metadata fields enter textContent. Never serialize the row, credential identifiers, prompts, tool content or unknown fields.
4. Keep ownership within the existing history render and identity lifecycle: reload, tabs, denial and disposal remove the details. No listeners, storage or new authority.
5. Prove meaningful RED/GREEN against the real history mount and clients; verify literal hostile strings, unknown versus zero, exact IDs, and teardown. Run regressions, typecheck and lint, then request exact-head review and CI.
6. Browser validation is local synthetic SSO/PGlite only unless actual approved IdP/deployment evidence exists. No production or paid calls.
