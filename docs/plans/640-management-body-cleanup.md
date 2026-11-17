# Bounded management mutation body cleanup

## Issue and problem
- Issue: #640, parent #637. Administrators issuing/revoking tokens must receive invalid-request responses even when an input producer never completes cancellation. Current readBody awaits reader.cancel in finally and can hang indefinitely on oversized bodies or abort.

## Scope and expected behavior
- Preserve authentication-first validation, fatal UTF-8, exact shape, 16KiB budget and no mutation on invalid input. Start stream cancellation but do not await producer cleanup. Rejections remain private and handled; release reader lock best-effort. No timeout, background reads, retry, permissions or new session authority.
- Out of scope: accepted mutations cannot be rolled back merely because the connection closes; no claim of server request deadlines or native browser acceptance.

## Design
- Change src/gateway/sso-management-http.ts only in body cleanup. Do not duplicate parsing or change limits. A rejecting or indefinitely pending underlying cancel is not a prerequisite for responding safely.
- Existing Request-stream contract and #640 security invariants remain unchanged. Add contract/acceptance notes; no new domain term or ADR.

## TDD plan
- Real Request/ReadableStream tests for issue and revoke: oversize plus permanently pending cancel, request abort plus permanently pending cancel. RED should be bounded response assertion, not missing module. Verify authentication called once and mutations never called. Cover rejecting cancel and continued subsequent valid requests.
- Run focused HTTP/service/client regressions, full TypeScript, changed-file Biome, planning and npm run check. Exact-head required CI and formal approval before merge.

## Delivery
- Isolated numbered branch/PR; capture RED/GREEN evidence. Rollback restores previous cleanup waiting without database migration. Local stream/HTTP tests are not installed PostgreSQL, company IdP, native browser or provider E2E.

## Verification evidence
- RED /tmp/og-0800-red.log: two oversize behavioral failures, two existing abort passes, zero skips. Permanently pending producer cancellation blocked both mutation routes.
- GREEN /tmp/og-0800-focused-final.log: 149/149 pass, zero skips across new cleanup tests and existing HTTP/issue/revoke clients. Exact safe error envelope, one cancellation, unlocked stream and no mutation verified.
- Full TypeScript, changed-file Biome, planning and whitespace checks pass. Aggregate npm run check cannot start: npm command not found.
- Expanded PostgreSQL HTTP regression could not complete: test process SIGKILL in both parallel and sequential execution; no database integration pass claimed. An intermediate test-envelope expectation omitted the existing message period and was corrected without production message changes. Full exact-head CI remains mandatory.
