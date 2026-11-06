# Exact credential metadata detail (#640)

1. Extend the missing credential list/detail foundation with a trusted internal single-record lookup by exact principal and credential ID using existing migration002. This is not a public API, read authority, or credential verification.
2. Select only lifecycle metadata. Return null for absent or other-principal IDs; project only IDs, creation/expiry/revocation timestamps and observed active/expired/revoked state. Never select digests or secrets. Explicit trusted observation time is not a historical/as-of query or authentication guarantee.
3. Validate bounded non-control Unicode identifiers and safe observation time before SQL. Capture inputs before await. Bind both identifiers in SQL, limit2 to detect invalid duplicate driver output, reject malformed rows, scope/ID mismatch, unsafe or inconsistent timestamps and private driver failures atomically.
4. First run behavior tests against an exported unimplemented reader, then implement. Test migration002 with existing issue -> inventory -> exact detail -> revoke -> fresh detail/verification denial and unchanged lifecycle audit count. Cover changed query during SQL, inclusive expiry and revoked precedence. No schema, session, runtime, UI, provider or paid changes.
5. Run focused and regression tests, full typecheck/lint/planning/compatibility; submit stacked draft PR on749. Exact required CI and valid independent formal approval, including ancestors, precede merge. Public read IAM and mandatory SSO audit remain reviewed-contract gates; do not infer list/detail permission from issue/revoke rights.

## Execution evidence

- Initial dependency-loader failure is not behavioral RED. Corrected node_modules symlink to existing installed toolchain; exported unimplemented reader then failed all7 behavior cases (/tmp/og-0630-red-behavior.log).
- Final new suite7PASS0FAIL0SKIP (/tmp/og-0630-focused.log), including actual migration002/PGlite issue -> inventory -> detail -> revoke -> fresh detail and verification denial, with exactly issued/revoked events. Reads add none.
- Broader credential regression48PASS0FAIL0SKIP includes the new7; it is not48 additional cases (/tmp/og-0630-regression.log).
- Full typecheck/lint/planning/compatibility/diff exit0 (/tmp/og-0630-exits.json). Repository lint retains existing42warnings/324infos; no warning-free claim. Resource-heavy fullsuite not duplicated; exact-head required CI still gates merge.
- Internal SQL/PGlite, not authenticated HTTP/native-browser/companyIdP/installed PostgreSQL/deployment. No standing execution URL. No public read IAM/audit/API/UI integration. Rollback reverts this source/docs/test-only commit without DDL.
