# Release discarded catalog response bodies

1. Refs #637/#639. Non-200 reads and late responses from abort-ignoring transports leave unread bodies open after the UI settles. Release them without parsing private errors or waiting for cancellation. No session, runtime, policy or provider changes.
2. Add failing stream-cancellation tests for existing error states, late responses, rejecting/stalled cancellation and subsequent successful navigation. Record RED before production changes.
3. Cancel discarded response streams best-effort; preserve status mapping, deadlines and stale-result suppression. Never wait for cleanup or expose cleanup errors.
4. Run focused client/session/authority/browser-build tests, typecheck, lint and planning checks. Require exact-head required CI and independent formal approval. Browser/SSO/deployment acceptance remains separate.
