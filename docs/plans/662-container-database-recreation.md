# Disposable logical database recreation (#662)

## 1. Existing scope

Parent #643, extending #566/#633/#654 backup and restore acceptance. Schema-loss #660 retains the database itself. Validate restoration into a newly recreated disposable database in both existing network modes. No runtime/API/IAM/provider changes or other owner work.

## 2. Design and acceptance

With gateway stopped, create a private custom-format archive. Use template1 as maintenance database to drop postgres, prove its absence, and create a fresh postgres database with template0. Prove catalog and migration tables absent. Restore fail-fast and assert the original disabled sentinel and exact migration history before gateway startup. Repeat HTTP401, persisted state and graceful shutdown. Preserve deny-all bootstrap, private archive, EXIT cleanup and bounded polling.

## 3. TDD and delivery

Add ordered regression first; demonstrate meaningful RED before workflow implementation, then GREEN and mutations for database drop, absence proof and pre-start history. Run focused tests, Bash syntax, typecheck, lint, contracts/pins and unchanged standard full gate. Docker unavailable locally: exact-head host/bridge CI must execute the phase. Require all exact-head checks SUCCESS and independent formal APPROVED before merge.

## 4. Boundaries

Only logical database recreation on the same disposable server. Not database-server/volume-loss, installed backup/restore, version rollback or live client/provider certification. Existing #643 and approved operator gates remain open.

## 5. Local checkpoint

RED: unchanged workflow gives 6 passes and 1 expected failure. GREEN: all 10 focused network/packaging tests pass, no skips. Independent drop, absence-proof and pre-start-history mutations are rejected. Three workflow Bash blocks pass syntax; typecheck, focused Biome, contracts/links/fixture-secret scan, pins and whitespace checks pass. Unchanged standard full check is running; no full-suite or local Docker success is claimed here. Require exact-head remote CI and formal approval.
