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
