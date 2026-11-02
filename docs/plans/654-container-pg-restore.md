# Disposable PostgreSQL container restore regression (#654)

## 1. Scope and existing requirement

Extend #633 under #566/#643 recovery acceptance with a disposable CI-only PostgreSQL logical archive restore. No runtime, API, IAM, trusted bootstrap, provider or installed deployment change. Do not touch #561/#644 or infer production recovery from a fixture.

## 2. Design and acceptance

In both existing host/bridge Container jobs, stop the gateway normally, create a custom-format pg_dump of the migrated disposable database, delete the inert disabled catalog sentinel and prove its absence. Restore the archive with pg_restore fail-fast and clean semantics while the gateway remains stopped. Compare exact catalog/migration history before the next gateway start, preventing migrations or reseeding from hiding restore failure. Reopen the same gateway, require HTTP401 and exact data/history, then SIGTERM exit0. Keep deny-all ports, existing finite polling and EXIT cleanup. The archive is transient, contains test data only, is mode600 and is removed with the fixture.

## 3. TDD and gates

Add a failing workflow contract regression first for archive/delete/restore ordering, stopped gateway, pre-start verification, repeated HTTP/data assertions and deny-all boundary. Implement workflow; run focused packaging tests, shell syntax, typecheck/lint, scripts and pinned compatibility checks. Require exact-head full CI including real host/bridge Docker jobs plus independent formal approval before merge. Local static checks are not Docker execution. Never claim database-server restart, volume loss, operator restore, installed VM or live-provider acceptance.

## 4. Deferred gates

Installed target image/config/database/backup/restore/rollback and live client/provider acceptance remain unverified and require existing operator approvals and protected inputs; no new security decisions are implied.

## 5. Local verification checkpoint (2026-11-02)

RED: new archive/restore workflow regression failed on the absent restored phase (2 passed, 1 expected failure). GREEN: all six focused networking/packaging cases passed with no skips. Typecheck, lint (existing 42 warnings/145 infos), workflow shell syntax, documentation/contracts/fixture-secret scan, pinned compatibility and whitespace checks passed. Initial lint formatting error was corrected before this checkpoint. No local Docker execution is claimed; exact-head CI and independent formal approval remain required.
