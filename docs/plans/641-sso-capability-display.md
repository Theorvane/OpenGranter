# SSO catalog published modality and parameter labels (#641)

1. Expose only administrator-published input/output modality arrays and supported parameter labels on the existing authenticated catalog list/detail API. These informational fields are not capability verification or routing authority; preserve legacy omission.
2. RED: persisted metadata through signed SSO, migrated PGlite and real HTTP loses these fields. HTTP output must strip extra nested fields and fail closed for malformed present arrays.
3. GREEN: copy frozen service arrays after unchanged current binding/IAM and mandatory audit; validate bounded, unique nonblank labels and serialize only approved fields.
4. Verify list/detail, empty arrays, legacy omission, denial/revocation/audit failures, typecheck, lint, planning and compatibility. Require exact-HEAD required CI plus independent formal approval before merge.
5. No session, DDL, runtime/startup activation, UI parser or provider calls. Local HTTP is not browser/company-IdP/installed acceptance.

## Execution evidence

- RED: 20 passed, 3 failed before production edits: published labels missing at persisted HTTP and trusted-service HTTP boundaries, malformed present output silently dropped.
- GREEN: 54 passed, 0 failed, 0 skipped with test-file concurrency 1. Migrated PGlite, signed test JWT, real loopback HTTP list/detail, current Deny/revocation, mandatory audit failure, framing, legacy omission, empty arrays, bounds, private-field stripping and unknown-label preservation covered. Initial parallel run received SIGKILL for one PGlite test process; it is not counted as success.
- Full typecheck and lint passed (42 existing warnings, 160 infos); planning/link/contract scan, six pinned compatibility schema checks and whitespace checks passed. No full local suite, native browser/company IdP/installed PostgreSQL/provider acceptance claimed. Browser parser remains owner-gated and separate.
