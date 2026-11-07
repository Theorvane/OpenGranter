# Principal usage drilldown integration (#637, #642)

1. Reuse only frontend #738 principal action (48f1dfe), independent source/artifact tests and contract on #757; preserve unrelated owners and ancestry.
2. Record meaningful RED before production changes. Extend public built workspace with signed test SSO / migrated PGlite / real loopback HTTP acceptance for explicit self ReadAll denial, no weaker retry, then test-only policy grant and exact scoped request.
3. Preserve model, time and page size; reset cursor, stale CSV and drafts. No directory grant or identity expansion; fresh IAM and mandatory audit remain authoritative.
4. Run focused tests, typecheck, lint, docs and full check; request exact-head independent review, all required CI and ancestor gates before merge. Rollback this bounded action only.
5. Native browser, installed PostgreSQL, real IdP, session, deployment and paid-provider acceptance stay separate and unclaimed.

Contract: [principal drilldown](../../contracts/principal-usage-drilldown.md).

## Evidence

- Independent source/artifact RED: 2 pass / 2 fail (missing principal action); public built signedHTTP RED: 10 pass / 1 fail, same missing action. Logs /tmp/og-1400-red.log and /tmp/og-1400-http-red.log.
- Production reuse is the exact 9-line frontend #738 principal action, no unrelated FE ancestry. Existing independent tests reused unchanged.
- Focused GREEN: 69 pass / 0 fail / 0 skip; includes source and built workspace through real signed testSSO HTTP and migrated PGlite. Each isolated workspace asserts 11 mandatory usage audits including explicit self denial, ReadAll scoped success, fresh IAM revocation and missing-audit fail closed. Native browser still unavailable (screen being released), not certified.
- Typecheck, Biome (14 informational template suggestions only), planning/links/fixture-secret check and git diff check PASS. Full exact-head check/CI/reviews remain separate gates.
