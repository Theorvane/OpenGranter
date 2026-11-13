# Operations late-response teardown

## Issue and problem
Issue #637. A trusted request can deliver headers after logout, expiry, identity replacement or navigation. The operations wrapper rejects that response but never cancels its unused body. RED direct Node test: 27 pass, 1 failure (late logout body cancellation count 0 instead of 1). Stalled-body tests already pass: existing consumers propagate cancellation, so no reader registry is needed.

## Scope and expected behavior
Dispose unused late response bodies without waiting for cancellation; retain existing denial disposal when the mount locks. Preserve current generic errors and unknown mutation outcome guidance. No session source, IAM, deployment, provider or public entry behavior changes.

## Design
After headers, reject invalid authority or aborted requests and cancel the unused body. Existing denial handling remains unchanged and is covered by regressions. Guard both synchronous and asynchronous cancellation failure; diagnostics remain private. Existing streamed delivery/backpressure stays unchanged. No new domain terms or product decisions. See docs/PRD.md, docs/architecture.md, docs/acceptance.md and contracts/management-operations.md.

## TDD plan
RED: late headers after logout (0 cancellations). Expand to expiry/replacement/navigation/disposal and denial with pending, throwing and rejecting cancellation. GREEN: minimal unused-body disposal. Keep stalled issuance tests as regression coverage. Run focused tests, typecheck, lint, npm run check, browser build.

## Delivery
Separate issue-numbered worktree, exact-head CI and formal approval before merge. Risks: reentrant cancellation; no post-cleanup DOM writes. Local cancellation cannot guarantee remote reclamation or mutation rollback. Rollback by isolated revert. Installed acceptance remains outstanding.

## Validation checkpoint (2026-11-13 20:00 KST execution)
Node 22.23.4 with GOMAXPROCS=1 and UV_THREADPOOL_SIZE=1: focused operations-session tests PASS 38/38, zero skipped, including the canonical browser build and all 16 added regressions. Direct TypeScript noEmit PASS; Biome exits successfully with existing warnings/information; planning/document/secret scan and all six pinned compatibility checks PASS. git diff --check PASS. npm run check was attempted but cannot start: the installed npm lacks walk-up-path. A direct sequential all-test run timed out after 300 seconds at test 7116 and includes a CLI artifact test failure; it is NOT a successful full check. Logs: /tmp/og-2000-focused22.log, /tmp/og-2000-tsc.log, /tmp/og-2000-lint.log, /tmp/og-2000-check22.log, /tmp/og-2000-alltests.log. Prior behavioral RED is retained above. No installed/browser/live-provider acceptance is claimed. Draft PR must remain unmerged pending complete exact-head required CI and formal approval.
