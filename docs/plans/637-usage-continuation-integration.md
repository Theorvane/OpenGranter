# Usage continuation integration (#637, #642)

1. Carry the reviewed internal service correction from #696 into the current workspace candidate. Keep the existing cursor and authorization contracts; do not widen bounds or activate sessions, schemas or deployment.
2. Before changing production code, reproduce the concrete SQL/HTTP defect with signed ephemeral SSO and migrated PGlite: an oversized continuation currently audits a ready row then returns internal_error at HTTP serialization. Require usage_unavailable and a durable unavailable audit with zero records for JSON and CSV.
3. Validate the encoded continuation before the service releases or audits a successful page. Preserve accepted multibyte next-page navigation and final-page behavior through the actual loopback server, including awaited durable audit failure.
4. Run focused integration, related usage/audit tests, full typecheck, lint and planning checks. Open a stacked PR with explicit candidate-base dependency; exact-head required CI and independent formal approval remain merge gates. Local SQL/HTTP evidence is not browser login, installed PostgreSQL or provider acceptance.

Contract: [usage history](../../contracts/sso-usage-history.md). Test: [HTTP integration](../../test/sso-usage-continuation-integration.test.ts).
