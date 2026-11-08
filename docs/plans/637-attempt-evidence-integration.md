# Attempt billing evidence integration (#637, #642)

1. Reuse only existing frontend #732 commit 784a2b4f61fd9706c45caa1d3074bf4fcef2ecb8 on the #756 public workspace dependency. Do not duplicate the component or import unrelated ancestry.
2. First copy its independent acceptance tests and strengthen existing signed-SSO loopback HTTP / migrated PGlite acceptance. Record RED for missing per-attempt fields.
3. Reuse the component and contract unchanged: exact decimal estimated versus reported amounts, known total tokens, unknown amounts, server-marked duplicates and caveat. Inspection reads only already authorized rows; no requests, raw identities or content are added.
4. Verify scoped values after model filtering and removal on fresh IAM denial and grant expiry; retain awaited mandatory audit counts. Run source/artifact tests, typecheck, lint, docs checks and full npm run check.
5. Open dependent PR, request exact-head independent review and require all ancestor gates before merge. Rollback this reuse only. #639 session, installed PostgreSQL, browser, provider, retention, runtime and deployment decisions remain unresolved, not inferred from local tests.

Contract: [attempt details](../../contracts/usage-attempt-details.md). PRD and acceptance #642 remain bounded by existing authorized ledger fields. No new billing model, schema, permissions or paid calls.

## Evidence

- Source and built module RED: 0 pass / 2 fail, missing Total tokens and cost evidence; signed-HTTP RED: 1 pass / 1 fail for the same missing field. Logs /tmp/og-1330-attempt-red.log and /tmp/og-1330-http-red.log.
- Reused production component and contract exactly from #732; no ancestor imports or new UI renderer. Added both source and built-module signedHTTP acceptance with exact tiny USD estimate versus zero EUR reported amount, missing completion counter, partial status, duplicate flag and unchanged mandatory audit count 10 per isolated runtime.
- GREEN focused 60 pass / 0 fail / 0 skip: /tmp/og-1330-focused.log. Typecheck, Biome (informational template suggestions only), planning checker and diff checker recorded separately. Full check and exact-head CI are separate gates, not inferred from focused success.
- Native browser unavailable: screen still being released. No browser/display restart, no native-browser success claimed. Base #756 and all ancestor exact-head CI/review gates remain required.
