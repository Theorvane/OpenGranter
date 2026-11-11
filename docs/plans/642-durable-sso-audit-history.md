# 642 Durable SSO audit-history HTTP composition

1. Preserve signed SSO/IAM audit:Read and scoped JSON/CSV.
2. Add dedicated metadata-only access-audit table via additive migration. Never manufacture proxy credentials or retain content/query/filter/results.
3. Validate actor, policy versions, target, outcome, count and request attribution. Await acknowledged insert before returning any service outcome.
4. Compose concrete store and existing service/Fetch without callback override. No migration/runtime/session/retention activation.
5. RED absent concrete composition import; GREEN signed SSO + migrated embedded SQL + Fetch: JSON/CSV/empty, fresh Deny/auth/query/SQL errors, delayed/failed insert and forged callback. Invalid metadata and acknowledgement tests.
6. Verify additive migration runner idempotence and prior checksums/data preservation; focused regressions, TypeScript, lint/scripts, exact-head PR formal review and CI.

Embedded SQL/Fetch is not native-browser, installed PostgreSQL, IdP or provider acceptance.

## Execution evidence

RED: concrete composition import failed with ERR_MODULE_NOT_FOUND before implementation. GREEN: 7 new store/composition cases plus 16 audit/usage regression cases pass (23/23, zero skipped); migration suite 8/8 passes. Full TypeScript passes; full Biome exits zero (42 existing warnings, 161 infos); planning/link/secret scan and six pinned schema checks pass. No full local standard check or native-browser/installed/provider claim.
