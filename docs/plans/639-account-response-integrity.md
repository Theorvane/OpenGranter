# Account response integrity (#639)

## Issue and problem
Account may publish valid JSON identity even when its declared unencoded Content-Length is incomplete or contradictory. It also consumes declared oversized responses before rejection.

## Scope and design
1. Preserve the fixed caller-authorized port, exact identity projection, IAM/audit, endpoints, deadlines and FE ownership. No login/session decisions, schemas, permissions, activation or provider calls.
2. For identity/absent Content-Encoding, validate Content-Length as a decimal byte count bounded by 4096 before consuming; require exact received byte count at EOF before parsing. Count bytes, not characters.
3. Fetch exposes decoded bytes: do not compare compressed wire length with decoded bytes. Always retain decoded 4096-byte bound and fatal UTF-8.
4. Cancel rejected/interrupted producers best effort without awaiting cleanup or exposing errors. Existing Account panel shows unavailable/retry instead of false identity.

## TDD and delivery
1. RED: valid JSON with shorter/longer declaration must be unavailable; oversized stalled producer must be cancelled without reading.
2. GREEN: minimum reader change. Cover missing/equal length, multibyte identity, encoded wire length, malformed declarations, streamed overflow, invalidation and safe retry.
3. Run client/panel/session/operations regressions and actual loopback HTTP signed-test-JWT + migrated embedded PostgreSQL acceptance, full typecheck, changed-file lint and scripts checker.
4. Publish dependent PR on #944; request exact-head independent review. Required CI and formal approval mandatory before merge. Rollback only reader change, no DB changes.

Contract: contracts/current-principal-client.md. Update PRD, architecture and acceptance failure semantics. Local tests are not company IdP/browser-login/installed-provider acceptance.

## Execution evidence (2026-11-16 21:30 KST)
- Initial RED: 1 pass / 4 fail; existing reader incorrectly returned ready or required invalidation for declared oversized stalled body. Overflow-specific RED: 6 pass / 1 fail before early overflow fix.
- Final Node 22 serial UI/client/session/operations regression: 68 pass / 0 fail / 0 skip, including actual HTTP stalled producer cancellation and gzip retry. Separate existing owned HTTP + signed synthetic RFC9068 JWT + embedded PostgreSQL suite: 4 pass / 0 fail / 0 skip (fresh inactive principal and missing required audit suppress identity).
- Full repository TypeScript check, changed-three-file Biome, planning/link/secret checker, six offline schema pins and diff check pass. This is NOT full npm check/full test suite.
- Node 24 initial embedded PostgreSQL executions were resource SIGKILL failures, not success. Diagnostic isolated SIGKILL; supported installed Node 22 serial bounded run passed. No unrelated process termination or resource-limit bypass.
- No browser/IdP/login/logout, persistent/external URL, installed PostgreSQL, deployment, provider or paid-call acceptance. The current-principal optional audit SQL remains caller-owned, not a new auto-installed migration.

## Integration verification (2026-11-19 08:00 KST)
- Integrated updated parent #944 exact ae3b7b54fd2ce43844e77fe4b5a21ae4f68f2281, retaining reviewed main, revocation handoff and the eight-file Account integrity delta. No duplicate transport or session authority. Parent remains unmerged; dependency gate is still required.
- Fresh meaningful RED against parent reader: 0 pass / 1 fail (contradictory Content-Length incorrectly published identity). Restored integrated reader GREEN: seven serial client/panel/session/token/operations suites, 51 pass / 0 fail / 0 skip, including actual loopback oversized producer cancellation and gzip retry.
- Additional Account/operations-session/browser-build group: 36 pass / 1 fail / 0 skip. In-process reviewed browser bundle cases passed; existing npm CLI artifact case failed (spawn status null). npm executable in installed Node distribution is zero-byte/non-executable, and direct standard npm CLI path is absent; full npm check could not start. No test modified to hide environment failure.
- Four embedded-PostgreSQL HTTP files were SIGKILL: 0 pass / 4 fail. Full repository TypeScript process also SIGKILL. No local full check, fresh owned-runtime acceptance or installed E2E success claimed.
- Full Biome check passed with 42 warnings / 181 infos; planning/link/fixture-secret checker, six pinned offline compatibility checks and diff checks passed. Logs: /tmp/og-190800-{red,green,http,browser-build,typecheck,lint,compat,fullcheck}.log.
- No browser/company IdP/installed PostgreSQL/external URL/deployment/provider/paid-call acceptance; previous acceptance is historical only.

## Main squash ancestry integration (2026-11-19 09:00 KST)
- #944 squash merged as aa5c4023ca4643951fdeccd6623a20fa47279875 after exact-head formal approval and all six CI checks succeeded. Retarget #945 main; merge this actual main to satisfy strict ancestry without dropping the Account integrity delta.
- Three documentation-only end-of-file conflicts retain Account integrity sections. Production delta remains the previously reviewed reader, tests and eight-file contract/plan scope. No API/session/schema/activation change. Fresh exact-head CI and independent review required; old approval is not evidence for the new merge HEAD.
- Fresh five reader/HTTP/panel/operations suites: 42 pass / 0 fail / 0 skip, including real loopback oversized producer cancellation and gzip retry; planning and diff checks pass. Production files unchanged by this ancestry merge. No fresh full TypeScript/full suite/installed acceptance claimed; independent review and CI pending. Log /tmp/og-190900-account.log.
