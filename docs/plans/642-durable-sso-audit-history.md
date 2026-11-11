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

## Review correction plan (2026-11-11)

1. Reproduce both stale migration bundle expectations without changing production migrations.
2. Expect 014 in the full trusted bundle and runtime migration history; preserve the explicit 013 usage-table assertion and assert the 014 audit-history table.
3. Run the two regression files and full standard check; request independent exact-head re-review after pushing.

Review regression reproduced: 22 cases, 20 pass and 2 fail before correction; 22/22 pass with zero skips after correction. Full standard check is running via direct equivalent commands because local npm is incomplete; CI remains authoritative.
