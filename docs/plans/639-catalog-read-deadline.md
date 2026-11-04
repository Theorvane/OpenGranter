# Bounded management catalog reads

1. Refs #637/#639. A stalled authorized transport or JSON body currently leaves the catalog loading forever. Bound each read to 30 seconds and surface the existing unavailable state. No session, HTTP runtime, authorization, storage or provider changes.
2. Add deterministic failing tests for stalled headers/body, ignored cancellation, superseded reads and timer cleanup. Observe RED before implementation.
3. Race the entire request/decode operation with a fixed deadline. Abort on expiry, settle cancellation on identity changes and clear resources on settlement. Never retry or reveal error text.
4. Run focused client/session/authority and browser-build tests, typecheck, lint and planning checks. Publish a separate PR; require exact-head required CI and formal approval before merge. Browser and real SSO acceptance remain separate.
