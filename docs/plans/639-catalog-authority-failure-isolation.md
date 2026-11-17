# Catalog authority teardown failure isolation (#637, #639, #641)

1. Preserve the explicit SSO/proxy selection and trusted-grant boundary. Reproduce teardown interruption when a cancellation hook throws, and stale state on clock/scheduling failure, before changing production code.
2. Invalidate revision and detach authority before invoking timer cleanup. Cleanup exceptions must never prevent aborting requests, clearing private state, replacing identity or disposal.
3. Treat thrown/non-finite/negative trusted clock readings as expired. Fail closed on a scheduler exception with unavailable state and no active request authority. Do not expose exception text.
4. Verify both factories: clear/logout, identity replacement, disposal, 401/403 locking, clock failure during reads/snapshot/timer, initial scheduling and rearming failure. Verify late responses cannot republish private data. Run focused lifecycle/HTTP tests, TypeScript, lint, planning/schema checks and full CI.
5. Require independent formal approval and all required CI on the exact HEAD before merge. No DOM/page edits, browser credentials, BFF/cookies, session storage, DDL, runtime activation, provider calls or deployment. Fake-port tests do not certify browser/IdP/installed PostgreSQL acceptance.
