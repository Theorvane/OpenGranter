# Complete nested audit evidence (#642)

1. Preserve existing PR852, FE ownership and API/security contracts. Fix only nested policy-version and eligible-candidate arrays in the shared event projector; PR857 addresses separate top-level event/SQL row arrays.
2. Reproduce skipped slots with RED tests at projector, durable store and browser JSON/page-CSV boundaries. Missing metadata must not become null entries in durable audit evidence or successful review/export.
3. Visit every nested array position using existing validators, rejecting the entire malformed event before SQL. Preserve dense ordering, empty arrays, bounds, allowlisting and the public error identity.
4. Verify migrated embedded SQL valid round trips, rejected-write non-insertion, browser-compiled clients, existing audit integration suites and full type/lint/planning checks.
5. Update existing PR852 only. Require exact-head mandatory CI and valid independent formal approval before merge. This is local/compiled-browser evidence, not native-browser login, installed PostgreSQL, production or provider acceptance.
