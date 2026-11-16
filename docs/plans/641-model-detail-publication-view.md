# Published model detail screen (#641)

1. Connect the existing authorized catalog list/detail lifecycle to the already published descriptive metadata. Preserve the sole Models navigation owner; change only the detail body plus a new text-only renderer.
2. Display name, description, context bounds, input/output modalities, supported parameters and published base prompt/completion rates. Label rates as USD per token (not billed cost), descriptive bounds as not enforced quotas, and capabilities as not a guarantee. Do not round or multiply price strings.
3. Preserve absent versus explicit unknown versus zero. Missing fields say Not published, null numeric bounds say Unknown, zero remains 0, empty lists say None published. Never invent capabilities, prices, invoice totals or permissions. All remote text enters textContent; unknown fields never render.
4. RED: detail DOM tests must fail before implementation. GREEN: render actual projected responses and verify navigation clears details during loading, empty/error/denial and disposal; signed synthetic JWT + migrated embedded PostgreSQL + Node HTTP tests preserve current IAM and mandatory audit.
5. Require exact-HEAD required CI and valid independent formal GitHub approval before merge. No login/session acquisition, cookie/CSRF contract, runtime activation, schema, provider request, production deployment or paid call. Browser test harness evidence is not administrator login or installed acceptance.

6. Provide explicit Refresh model for the selected alias through the same fresh authorized detail read. Clear old publication while loading; a missing, denied or unavailable response cannot preserve stale metadata. Back to models and the sole outer Models owner remain unchanged.

## Local execution evidence (2026-11-17 05:30 KST)

- Separate worktree based on PR950 d02d38f; selectively recovered the prior own unfinished implementation, leaving all original worktrees untouched.
- RED before production copy: four publication/detail-control assertions failed against the base renderer.
- GREEN: 43 tests across publication DOM, actual signed-JWT HTTP + migrated PGlite, catalog application and client; 48 separate catalog rendering, SSO app, publication transport, authority and lifetime regressions. Both commands use Node 22.23.4, 192 MiB V8 cap and one test worker; zero skips. An earlier unrestricted concurrent HTTP run was SIGKILLed by local resource limits, not counted as passing.
- Full repository TypeScript check passed with a 256 MiB V8 cap; changed TypeScript Biome check, script/docs/contract/fixture scan, six pinned schema checks and diff whitespace check passed. No local whole-suite/npm-check success claim.
- Visible Chromium at loopback port 45305: select team/chat, literal markup displayed as text, exact tiny prompt price and zero completion price, distinct unknown/zero bounds, Refresh model shows loading then re-fetches the detail. Local Node HTTP log records separate 200 reads and durable access-audit row counts. This synthetic JWT/embedded SQL harness is NOT a website login, deployed user URL, installed PostgreSQL, TLS, real IdP or provider acceptance.
- No merge without exact-HEAD required CI and valid independent formal GitHub approval. Existing stacked dependencies remain review-gated.
