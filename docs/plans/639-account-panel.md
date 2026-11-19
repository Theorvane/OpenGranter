# Account panel (#639)

1. Add only current-principal-panel.ts and new tests; preserve frontend-owned shell/navigation. Consume PR937 canonical read port; do not establish session authority.
2. Render accessible loading, exact id/human detail, refresh, unavailable/retry and terminal unauthenticated/denied states with textContent only. No storage, tokens, login links or permissions inferred from identity.
3. Clear identity text synchronously on refresh/dispose; abort pending reads. Detached controls and stale results must not revive old content. Logout/expiry/identity changes require caller disposal; no fake logout button.
4. Prove meaningful RED for missing module, then GREEN for states, injection safety, retries, terminal denials, ignored transport cancellation and detached controls. Exercise actual owned Node HTTP + signed synthetic JWT + migrated embedded PostgreSQL with required audit store, active identity and deactivation.
5. Run focused regression suites, full TypeScript, changed-file lint, scripts/compatibility checks, public bundle boundary and diff checks. Commit as sjungwon03 and open dependent draft PR. Require exact-head full required CI and independent formal approval before merge.

Acceptance: initial loading -> ready id/kind; refresh clears identity immediately; malformed/failed response -> sanitized error/retry; 401/403 -> terminal without automatic fetch/retry; dispose -> empty DOM and no reanimation. No claims of real IdP, browser login, installed PostgreSQL/TLS, deployment or provider E2E from local synthetic tests.

## Main integration checkpoint — 2026-11-18

Integrate reviewed canonical transport and owned-listener changes from main after PR937. Preserve frontend shell ownership. Extend actual HTTP DOM acceptance for binding removal, terminal mount/stale-control behavior, and a new trusted-host mount after explicit rebinding to a different identity, asserting exact ordered durable audit outcomes. No session or schema activation decisions are introduced.
