# Disposable gateway replacement (#658)

## 1. Existing scope

Extend #566/#633/#656 under #643 restart/recovery acceptance. Remove the stopped disposable gateway and create a distinct container from the same tested image against unchanged PostgreSQL in both host/bridge CI cases. No runtime, API, IAM, provider, database replacement or #561/#644 changes.

## 2. Acceptance and design

Extract the existing hardened docker run into one launch function so initial and replacement containers share network/bootstrap/security flags. After database restart validation and graceful gateway stop, capture old ID, prove stopped, remove without force, verify exact inert sentinel and migration history before launching replacement, then prove a different nonempty ID. Shared bounded HTTP401/data/history/SIGTERM0 checks run on replacement too. Keep deny-all ports, fixture cleanup and existing database unchanged. Same-image replacement is not image-version rollback, volume-loss recovery, installed acceptance or live certification.

## 3. TDD and delivery gates

Add a failing workflow contract test covering replacement phase, stopped/remove/pre-start verification/launch/identity order, shared launch security and repeated HTTP/data/shutdown. Implement after RED. Run focused tests, syntax, typecheck/lint, scripts/pins and unchanged full check. Require exact-head full CI including real host/bridge jobs and independent formal approval before merge. Docker is unavailable locally; do not claim local container execution.

## 4. Local checkpoint

RED: 4 pass and 1 expected failure for absent recreated phase. GREEN: 8 focused tests pass with no skips. Three isolated mutations (identity inequality, pre-start history, stopped-gateway guard) are rejected. Extracted workflow Bash syntax, planning/contracts/fixture scan, pinned compatibility and whitespace checks pass. Unchanged npm run check is running; no full-pass claim yet. Docker unavailable locally; exact-head host/bridge CI and independent formal approval remain mandatory. Initial shell command was blocked for backticks, then staged Python was used; incorrect isolated Node path was corrected to nested bin. No repository or shared tooling changes for these tool errors.
