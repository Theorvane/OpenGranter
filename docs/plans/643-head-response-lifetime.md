# HEAD response producer lifetime (#643)

1. Reproduce actual loopback HEAD requests consuming or waiting for normal and error-fallback response producers.
2. Preserve validated response status and representation headers while cancelling unused bodies without awaiting cleanup. Never read a HEAD response producer.
3. Test normal/fallback producers, throwing/rejecting/stalled cleanup, invalid headers and subsequent GET behavior. Keep GET streaming/error containment unchanged.
4. Run focused socket regressions, TypeScript, lint and contract checks; require exact-head CI and independent formal approval before merge.

No authentication, permissions, cookie/session, deployment or default selection changes. Actual installed browser/provider acceptance remains separate.

## Current-parent integration and disconnected fallback

Reconcile the current #957 parent, retaining its process port allowlist and management executable. The shared lifetime contract must also cover a disconnect while a non-HEAD fallback body is being buffered: cancel the active reader without waiting for cleanup, settle the real request listener, and preserve existing UTF-8 text decoding and safe fallback containment. Add socket regressions for complete, throwing, rejecting and stalled cancellation; confirm a subsequent GET still works. No new runtime selection or deployment activation.
