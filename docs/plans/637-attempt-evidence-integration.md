# Attempt billing evidence integration (#637, #642)

1. Reuse only existing frontend #732 commit 784a2b4f61fd9706c45caa1d3074bf4fcef2ecb8 on the #756 public workspace dependency. Do not duplicate the component or import unrelated ancestry.
2. First copy its independent acceptance tests and strengthen existing signed-SSO loopback HTTP / migrated PGlite acceptance. Record RED for missing per-attempt fields.
3. Reuse the component and contract unchanged: exact decimal estimated versus reported amounts, known total tokens, unknown amounts, server-marked duplicates and caveat. Inspection reads only already authorized rows; no requests, raw identities or content are added.
4. Verify scoped values after model filtering and removal on fresh IAM denial and grant expiry; retain awaited mandatory audit counts. Run source/artifact tests, typecheck, lint, docs checks and full npm run check.
5. Open dependent PR, request exact-head independent review and require all ancestor gates before merge. Rollback this reuse only. #639 session, installed PostgreSQL, browser, provider, retention, runtime and deployment decisions remain unresolved, not inferred from local tests.

Contract: [attempt details](../../contracts/usage-attempt-details.md). PRD and acceptance #642 remain bounded by existing authorized ledger fields. No new billing model, schema, permissions or paid calls.
