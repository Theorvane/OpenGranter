# Audit denial integration: await terminal HTTP state

1. Observed RED: PR #834 at 2c6955a, Actions run 42680495231 failed management-audit-event-detail.test.ts:193: after 30ms the actual signed SSO/SQL/HTTP response was still loading, not denied. The other check run passed. This is not evidence of a successful release.
2. Replace the fixed sleep with a bounded 10-second terminal-denial wait. Assert scoped credentials, policy versions and event data stay absent during every pending observation. Keep the final exact denial and redaction assertions; an unavailable/loading response still fails. No production authorization, session, retries or API contracts are changed.
3. GREEN: audit-event-detail, usage-refresh and source/compiled usage-integration: 12 passed, zero failed/skipped. Full TypeScript check passes. Exact revised-head remote CI and independent formal approval remain required.
4. Previous local full check is failed: 9818 tests, 9813 passed, 4 SIGKILL, 1 skipped. Do not relabel targeted tests or the successful duplicate CI job as a full pass. Browser behavior evidence remains in the prior usage retry plan; this correction adds no new browser/deployment claim.
