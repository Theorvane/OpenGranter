# Usage attempt detail inspection (#642)

1. Add a regression for per-row expandable content-free attempt metadata, exact cost strings and Unknown values. Run it before implementation and retain the behavioral failure.
2. Render native details/summary within the existing authorized usage row; use only textContent, no additional request, no tokens or credential identifiers.
3. Include request/attempt IDs, route/model/provider, latency, token breakdown, estimated price version and reported billing source. Preserve unknowns without reconciliation or billing inference.
4. Verify detail removal on loading, denied/expired/clear/dispose and independence across rows using structural DOM tests; run focused HTTP tests, typecheck and lint. Real-browser acceptance remains separate.
5. Open a stacked PR against the usage screen, request independent exact-head review and require full CI plus formal approval before merge. Do not activate session, schema, listener or deployment.
