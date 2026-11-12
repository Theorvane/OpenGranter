# Management socket body cancellation

## Issue and problem
Refs #637 and #640. Cancelling Readable.toWeb(IncomingMessage) can destroy the shared socket and erase a management invalid-body response.

## Scope and expected behavior
Preserve bounded 400 responses without draining an unbounded upload or reusing an incomplete request connection. No IAM, session, audit, body-limit, provider or mutation changes.

## Design
Isolate management cancellation using a separate readable over the non-destructive incoming iterator. Disable keep-alive when the management input is incomplete. Keep proxy streaming unchanged; actual peer disconnects still abort the handler. Existing session and deployment gates remain separate.
Update PRD, architecture, acceptance and transport contract.

## TDD plan
First reproduce oversized issue/revoke requests on real loopback sockets: RED should be an unavailable response instead of 400. GREEN requires a fixed no-store 400 without EOF, zero mutation, and unchanged normal requests/disconnect handling. Run socket/management/adapter regressions, TypeScript, Biome, planning check and npm run check.

## Delivery
Only Node transport, behavioral tests and documentation. Record exact RED/GREEN and review/CI. No browser, real SSO/PostgreSQL, installed or provider certification. Revert transport commit to roll back; no schema changes.

## Verification evidence

- RED: two real-socket oversized issue/revoke uploads failed the one-second response bound (0/2 pass); earlier unbounded harness reached test timeouts, then was bounded explicitly.
- GREEN: seven new socket cases plus management cleanup, adapter/fallback and client-disconnection regressions: 155/155 pass, zero skips.
- Full TypeScript, changed-file Biome, planning/link/secret scan, compatibility pins and diff whitespace checks pass.
- npm run check cannot start: installed npm is a zero-byte non-executable file (Permission denied). No environment repair or full-suite success claim.
- Initial Node executable selection failed (system Node lacks strip-types; x64 binary mismatches arm64). Tests above ran with the installed arm64 Node 22.23.4.
- An initially considered separate canonical process was not implemented: repository inspection confirmed the existing canonical-review-service and start-canonical-review entry already cover it.
