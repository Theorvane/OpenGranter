# Disposable database server restart (#656)

## 1. Existing requirement and scope

Extend #566/#633/#654 under #643 restart/recovery acceptance. Restart the same disposable PostgreSQL 17 container in both host/bridge CI jobs with the gateway stopped. No runtime/API/IAM/provider change, production deployment, volume-loss simulation or work on #561/#644.

## 2. Acceptance and design

After logical restore, stop the gateway normally, prove it stopped, stop PostgreSQL with a finite grace period and require exit0. Start the same database container and poll pg_isready with a finite loop and explicit final assertion. Compare the exact disabled sentinel and migration history before reopening the gateway so migrations/reseeding cannot hide loss. Repeat HTTP401, exact data/history and SIGTERM0 in the shared phase loop. Preserve deny-all ports and cleanup. This proves only same-container server restart, not volume replacement or installed operator recovery.

## 3. TDD and delivery gates

Add a meaningful failing workflow contract test for the additional phase and strict stop/readiness/pre-start verification order, then implement. Run focused tests, syntax, typecheck/lint, documentation/pinned checks and unchanged full check. Local static checks are not Docker evidence. Require exact-head host/bridge CI and independent formal approval before merge. No live credentials or paid requests.

## 4. Local verification checkpoint

Node22 workflow regression RED: 3 pass, 1 expected failure for missing database_restarted phase. GREEN: all 7 network/packaging tests pass without skips. Extracted Bash syntax, direct TypeScript noEmit, Biome (42 warnings/145 infos, no errors), planning/contract/fixture scan, pinned schema checks and diff whitespace pass. Default Node18 cannot run strip-types; the pre-existing Node22 npm installation is broken (missing walk-up-path). No shared tooling was modified. An isolated extraction of the existing Node22.23.4 archive supplies npm10.9.9 for unchanged npm run check, now running; no full-pass claim yet. Docker is not installed locally: actual server restart must be demonstrated by exact-head host/bridge CI. Installed VM, volume-loss recovery and live-provider acceptance remain unverified.
