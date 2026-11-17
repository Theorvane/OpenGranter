# Disconnected management response cleanup (#637)

1. Preserve the existing original PRD and #638–#643 scope. Administrator sessions require approved contracts; do not implement or activate them here. Reproduce an independent HTTP transport defect that can retain a completed management handler after its client disconnects.
2. Specify that a response returned after socket disconnect is discarded exactly once. Initiate best-effort response cancellation, but never await producer cleanup. Rejected, throwing, stalled and locked cleanup must not prevent the Node request listener settling and removing its listeners. No response may be sent to the disconnected client.
3. Before production changes, use actual bound loopback Node HTTP requests to disconnect while the application handler is pending. Monitor completion of the real Node request listener, cancellation counts and application request signal. Include an ordinary second request to demonstrate continued service. A stalled cleanup must fail the old implementation, not merely assert an internal helper result.
4. Reuse the existing safe discard helper instead of creating a new cleanup policy. Preserve live streaming, fallback containment, authentication, audit/mutation outcomes and no-store behavior. Cancellation does not roll back committed operations or forcibly release a producer that ignores cancellation.
5. Run RED/GREEN and bounded serial transport/management regressions, full TypeScript, changed-file lint, scripts and pinned compatibility checks. Record local evidence separately from installed PostgreSQL, browser login, CI and live providers.
6. Submit the isolated change as a PR; obtain independent exact-head formal approval and all required CI before merge. No production/paid calls, session authority, deployment or frontend changes.

## Canonical main integration checkpoint (2026-11-18)
1. Merge reviewed main 60e9ba66, preserving both disconnected-response and canonical review DOM requirements. Retain the existing production fix; no session/runtime activation or duplicate factory.
2. Run the actual loopback disconnected-response cases plus transport and canonical browser-build/review-controller regressions against this combined tree. Keep cancellation-ignoring producer limits explicit.
3. Re-run TypeScript, lint, repository checks and pinned schemas. Push the existing PR branch without force; request fresh exact-head formal review and required CI before merge.

Integration evidence: 56/56 actual loopback transport and canonical review/build regression cases passed with zero skips. Full TypeScript, full lint (42 existing warnings/175 information), repository script checks and all six pinned schemas passed. Separate resource-failed gateway disk-recovery case from PR932 full-run passed in isolation (1/1); its earlier aggregate SIGKILL remains recorded, not converted into a full-suite success. Native browser/IdP/installed PostgreSQL/provider results remain unverified.
