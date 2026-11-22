# Canonical Audit-to-Usage request investigation

## Issue and problem
Issue #994, original #637/#642. Canonical history omits existing PR950 Audit-to-Usage action. Source950 is not fully superseded.

## Scope and design
Integrate source950 action into canonical history-app only. Use canonical select to cancel outgoing CSV before changing view; preserve pending JSON coalescing contract. Exact request ID intersects destination applied Usage principal/model/time/page size; never copy Audit scope or mutable drafts. Clear destination drafts/cursors and issue fresh authorized Usage read. Terminal denial clears both reviews; stale controls remain inert. No new domain terms, session/runtime/DDL/public activation or unresolved policy decisions.

## Test plan
Port source950 public-mount tests before production edits and record RED. Include fresh denial/error, exact encoded identifiers, scope intersection, invalid query, disposal/late completion, refresh retirement. Port signed synthetic SSO + migrated PGlite HTTP test; native production bundle browser probe. Run serial history regression, typecheck/lint/planning checks and npm run check; distinguish failures from CI.

## Delivery and rollback
Stack on draft PR993 exact80616a1. Parent must merge first; latest-head required CI plus independent formal approval mandatory. Remove row action to roll back without changing API/IAM/session. No installed IdP/PostgreSQL/provider/deployment or public URL claim.

## Validation recorded 2026-11-23 05:00 KST
Recovered the existing uncommitted integration and verified final tests against parent 80616a1 in a detached worktree: RED 0 pass / 10 fail, missing Audit investigation action. Current public-mount regression GREEN 10 pass / 0 fail / 0 skip. Serial history regression: 110 pass, one failed file (management-history-workspace-integration.test.ts, SIGKILL), no skips; this is not a passing suite. Signed-JWT/PGlite HTTP test also terminated with SIGKILL before assertions completed; installed or HTTP acceptance is not certified. Default local typecheck was killed; capped attempt pending at this record. Changed-file Biome, planning/links/secret scan and diff check passed. Native browser synthetic probe at loopback port 19689 passed destination scope, draft clearing, retired control invalidation, fresh denial and disposal (7 requests); this is not deployed IdP/PostgreSQL/provider E2E. Standard full check and exact-head CI remain required. Prior parent full check finished 10363 pass / 5 failed-file SIGKILL / 1 skip; parent GitHub checks succeeded but do not certify this change. No new activation or merge approval.

## Validation recorded 2026-11-23 05:30 KST
Re-ran the public-mount suite with Node 22.23.0: 10 pass / 0 fail / 0 skip. Changed-file Biome, planning checker and diff check pass. The first focused invocation used the system Node 18 and failed before tests; it is not test evidence. An initial background full-check launcher could not find npm and never started validation. After explicitly selecting the installed Node 22 toolchain, standard npm run check terminated during typecheck (exit 137, Killed), even with native Go compiler concurrency/memory targets; lint/tests later in that chain did not run. Standalone constrained typecheck was also killed. Inherited HTTP/history SIGKILL failures remain unresolved; no live deployed acceptance is asserted. Preparing a draft stacked PR for independent review only, not merge readiness.
