# Disk-backed gateway recovery regression (#652)

## Scope

Bounded follow-up to #633 and the existing restart/recovery acceptance: retain a disposable disk-backed PGlite process regression in the standard test suite. No runtime, API, IAM, session, bootstrap policy or deployment change. Do not touch #561/#644.

## Design and acceptance

Spawn the real gateway executable against one disposable database. Preserve a disabled catalog sentinel and exact migration history across SIGINT/SIGTERM reopens. Save a cold fixture archive, deliberately delete the sentinel, restore the archive, then verify records before and after process startup. Independently inject checksum corruption, an interior history gap and a future version; require exit 1, no listener on either base, unchanged history/catalog and no limit/secret invocation. Recover pristine data and start again. Bound child lifetimes and clean up only fixture directories; use an environment allowlist.

## Verification

Fault-injection RED: remove the catalog sentinel before a reopen to show the persistence assertion fails. GREEN: run the unmodified persisted fixture, focused CLI tests, typecheck/lint, full required CI and independent exact-head formal approval before merge. This is PGlite regression evidence, not Docker, external PostgreSQL, installed VM, operator backup/restore or live-provider acceptance.

## Local checkpoint (2026-11-02)

Fault-injection RED deleted the sentinel immediately before process reopen: expected deep-equality failure, 0/1 passed. Restored the unmodified test: disk recovery plus existing executable CLI tests passed 4/4, no skips. Typecheck, lint (existing warnings/information only), documentation/contract/fixture-secret scan, pinned schema compatibility and diff whitespace checks passed. A serial full-suite run is pending; it is not the unchanged standard full gate. Exact-head CI/formal approval remain required. No installed/Docker/PostgreSQL/provider acceptance is claimed.
