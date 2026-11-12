# Canonical audit browser contracts

## Issue and problem
Refs #642, #637. The actual audit review coordinator cannot be built by the canonical management browser builder: its query/page projector imports server-oriented audit modules. This blocks the reviewed screen artifact even though the validation itself is pure.

## Scope and expected behavior
Extract the existing query, filter, time-range, event metadata projection and history data types into a fixed pure shared audit closure. Preserve server exports, function/error identity and existing HTTP/SQL contracts. Build and execute the actual audit client/review with the canonical builder. Preserve redaction, exact bigint cursors, loading/empty/error/denial invalidation and explicit CSV export.
No general server allowlist, entry activation, DOM/navigation, new session/CSRF/IdP policy, IAM grant, retention decision, provider call or deployment. Frontend owns entry/navigation; backend owns HTTP/session. Existing signed request port remains authoritative.

## Design
Move, do not copy, pure implementations; old audit paths reexport canonical objects. Keep SQL ports and append/read factories server-only. Permit only enumerated shared files transitively, never as direct entries. Shared symlink escape stays denied. This follows the usage extraction already merged in #901; a second independent browser validator or broad server-source exception would create drift or expose runtime code. No domain terminology or costly new policy decision is introduced. Original PRD R4 contracts remain unchanged.

## TDD plan
First add actual audit review build/execution test: expected RED is the current forbidden server import. Check loading, ready, empty, unavailable, filter rejection, fresh denial clearing and explicit CSV; malformed event projection must fail, private fields must be absent. After extraction assert compatibility function/error identities. Build through a symlink checkout and reject shared direct entries/escapes and server imports. Run existing audit query, persistence, gateway, CSV, client and review tests plus canonical builder suite, tsc/Biome/planning and attempt full npm check without skipping failures.

## Delivery
Plan then meaningful RED then minimal extraction and fixed allowlist then GREEN and PR. Review exact HEAD and all required CI before merge. Rollback is reverting this extraction, not weakening boundaries. Local compiled module execution is not installed PostgreSQL/company IdP/native browser acceptance.

## Verification (2026-11-13 06:30 KST execution)

- RED: actual audit coordinator/client builds fail the existing source boundary, 0 pass / 3 fail / 0 skip (`/tmp/og-0630-red-valid.log`).
- GREEN: canonical artifact + signed fixture SSO/actual loopback HTTP/migrated PGlite, audit history/projection/CSV/trace/persistence/client/export/review, usage artifact/runtime and canonical bootstrap selection: 100 pass / 0 fail / 0 skip (`/tmp/og-0630-regression.log`).
- Full TypeScript check passed; changed-file Biome and planning checker passed. No raw credentials or provider calls.
- Full `npm run check` attempted with explicit Node22 PATH; npm itself fails before scripts with missing `walk-up-path` in the preexisting local npm installation (`/tmp/og-0630-fullcheck.log`). No skip, aggregate full-check claim or toolchain repair. CI remains the exact-head complete gate.
