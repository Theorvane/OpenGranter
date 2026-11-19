# Published SSO model token bounds (#641)

1. Extend authenticated list/detail with optional published top_provider context_length and max_completion_tokens only. These are administrator metadata, not enforced quotas, effective routing limits or inference authority. Preserve absent, null and zero distinctly.
2. RED: persisted signed-JWT/PGlite HTTP must retain published bounds; HTTP must reject invalid present bounds and strip private nested fields.
3. GREEN: copy immutable metadata after current IAM and mandatory audit; project only safe nonnegative integers or explicit null.
4. Verify regression, typecheck, lint, contract/planning checks, exact-head CI and independent formal approval before merge.
5. No browser/session changes, runtime activation, DDL, provider requests or deployment acceptance.

## Execution evidence

- RED: 23 passed, 3 failed before production edits (persisted HTTP loses fields; trusted HTTP loses fields; malformed bounds silently omitted).
- GREEN: 53 passed, 0 failed, 0 skipped with file concurrency 1; migrated PGlite, signed test JWT and real Node HTTP list/detail, numeric/null/zero/omission, no moderation/private nested fields, current Deny/revocation and mandatory audit failure.
- Full typecheck passed after serial correction; initial concurrent attempt was killed and is not success. Lint passed with 42 existing warnings and 160 infos. Planning/link/contracts, six pinned compatibility checks and whitespace checks passed.
- No full local suite, browser/company IdP/installed PostgreSQL/provider E2E or deployment claim. Browser adoption remains frontend-owned.
