# SSO catalog publication transport integration (#641)

1. Integrate the already-reviewed HTTP publication (#800/#801/#802) into the existing SSO client. Do not add new API fields, session authority or UI files.
2. RED: assert real migrated PGlite / signed test JWT / Node HTTP publication reaches the client; unit cases require invalid bounds to fail whole pages and strip private nested fields.
3. GREEN: preserve approved prices, architecture, parameter labels and provider token bounds through the explicit SSO projection. Distinguish absence, null and zero; use immutable copied known fields. Keep proxy behavior unchanged.
4. Verify transport, IAM, binding revocation, mandatory audit failure and lifecycle regressions, typecheck, lint and contract checks. Require exact-head CI and formal independent approval before merge.
5. Browser rendering remains frontend-owned. No browser grant acquisition, login/session decision, schema promotion, runtime activation, provider call or deployment is authorized by this change.

## Execution evidence

- RED: 10 passed / 4 failed before production changes after correcting the new persisted-test metadata fixture shape; failures expose lost publication and ignored malformed bounds. Initial pre-correction fixture error is not integration evidence.
- GREEN: 57 passed / 0 failed / 0 skipped, serial focused client/lifecycle/actual Node HTTP/runtime/build suites. Persisted numeric/null/zero publication reaches the SSO client, fresh Deny hides detail and empties list, binding revocation returns unauthenticated, mandatory audit failure returns unavailable.
- Full typecheck passed after correcting two test-only typing issues; initial failed typecheck retained separately. Lint passed (42 existing warnings, 160 infos), planning/link/contracts and all six offline pinned compatibility checks passed.
- No full local test-suite, native browser, company IdP, installed PostgreSQL, provider call or deployment success claim. Browser screen unavailable (screen being released).
