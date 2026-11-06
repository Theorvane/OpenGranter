# Management body rejection cleanup

## Issue and problem

- Issue: #640; parent #637.
- Credential issue/revoke authenticated uploads already reject invalid UTF-8, more than 16384 streamed bytes and cancellation before mutation. The parser currently awaits the underlying stream cancellation during cleanup. A never-settling cancellation can prevent a known rejection from completing indefinitely.

## Scope and expected behavior

- Preserve both existing POST routes, registered-key authentication before body consumption, exact inputs, current IAM and mandatory decision/lifecycle audit.
- On early parser rejection or abort, request cancellation once, observe rejection without awaiting it, release the reader lock, and return the existing safe 400. A stream cleanup failure is never mutation permission.
- No new upload deadline, session, role, route, schema, runtime activation, provider or paid call. This is not rollback of a dispatched write.

## Design

1. Reproduce hanging cancellation through the public Fetch handler for issue and revoke, using oversized bytes, invalid UTF-8 and an aborted pending read.
2. Replace blocking cleanup with a best-effort observed cancellation request; keep listener removal and lock release in all paths.
3. Verify cancelling/rejecting streams cannot dispatch issue/revoke and normal completed bodies are not cancelled.
4. Exercise the registered-key PostgreSQL composition with migrated PGlite, then actual loopback HTTP success and current Deny. Installed PostgreSQL and native-browser login remain separate gates.

Alternatives: adding an arbitrary timeout would introduce policy and still delay an already-known rejection. The selected change only removes the unnecessary dependency on source cleanup completion. Slow valid uploads remain governed by caller-owned server timeouts, not a newly invented deadline.

## TDD plan

- RED: public-handler result must settle after oversized/invalid/aborted uploads even while cancel remains pending; original implementation times out.
- GREEN: focused parser, current-auth/transaction/audit and socket tests, full typecheck/lint/planning/compatibility checks; exact-head CI required before merge.
- Cover cancellation rejection, no unhandled rejection, lock release, no mutation and unchanged success/auth denial.

## Delivery

- Source ownership: src/gateway/sso-management-http.ts only; frontend unchanged.
- Update PRD, architecture, acceptance and contracts/sso-management-http.md. Rollback is reverting this bounded change; no data migration.
- Publish RED/GREEN and exact revision in a draft stacked PR. Require independent formal approval and all required exact-head CI, including ancestors, before merge.

## Execution evidence

- RED public-handler subset: 14 cases, 4 expected failures (issue/revoke × oversized/invalid UTF-8 with pending cancellation), 10 passes. Each failure reports known rejection blocked on body cancellation. Abort controls already passed; no claim they were newly failing.
- GREEN: public HTTP/registered SSO management suites 178 pass, zero fail/skip. Includes 14 new parser/control cases and 1 new signed-test-JWT migrated-PGlite case; these subsets are not additional to 178. The latter tests hanging cleanup through Fetch composition, then actual loopback HTTP issue Allow, newly persisted revoke Deny and deleted binding 401 with retained SQL state/audits. Not company IdP or installed PostgreSQL.
- Full typecheck, repository lint, planning checks, compatibility schema check and diff check all exit zero. Full exact-head CI remains a merge prerequisite; prior fullsuite resource/installed limitations are not erased.
