# Explicit workspace runtime composition (#637 / #639)

1. Close the demonstrated main-listener Account 404 by reusing existing reviewed-source SSO administration handlers in a separately selected runtime, not by granting browser/session authority. Frontend files remain frontend-owned. This branch stacks on the #796 source consolidation; all inherited review/schema gates remain.
2. RED: actual Node loopback requests against owned PGlite must prove public assets need no identity SQL, anonymous Account requests are denied only after required audit, signed Account returns the existing principal projection, binding removal is effective on the next request, and missing audit schema never exposes identity.
3. Add an explicit workspace start function for safe local source integration requested by the user; request architect confirmation before any promotion/activation. Reuse the existing owned connection/migration/listen/close core. No default runtime/CLI activation and no callback auth override. Require an explicit public artifact.
4. Reuse the existing dedicated identity and usage audit adapters. Their candidate schemas are NOT added to migrations or installed by this function. Only disposable test databases install candidate DDL. Missing tables fail closed; do not fabricate credential attribution.
5. GREEN: focused existing/runtime suites, TypeScript, lint and scripts checks. Real HTTP plus embedded database is not native-browser, installed PostgreSQL, IdP/session, provider or production acceptance.
6. Submit a draft stacked PR with exact dependency/base evidence. Require independent formal exact-head approval and every required CI before any merge. Session/DDL/deploy decisions remain independent gates.

## Local implementation evidence

- RED /tmp/og-2100-red.log: missing workspace runtime export before implementation. An intermediate test used an incorrect candidate usage-DDL path; corrected to the existing contracts/sso-usage-audit-schema.sql.
- GREEN /tmp/og-2100-green2.log: 2/2 real loopback + disposable embedded database tests, zero skips. A TypeScript callback mismatch was corrected to the existing asynchronous owned-core contract.
- Source contract: contracts/sso-workspace-runtime.md. No default activation or candidate migration change.

- Focused regression suite /tmp/og-2100-focused.log: 17/17 pass, zero failures/skips. TypeScript PASS; npm run lint exits0 (existing warnings/info), scripts/check.py PASS. Native desktop observation still returns500 screen-release: no rendering/session claim.
