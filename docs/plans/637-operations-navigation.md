# Management operations navigation

## Issue and problem
- Issue: #637; child scopes #640 and #642. Existing token mutations and history screens have no shared navigation mount for an approved caller.

## Scope and expected behavior
- Compose existing history and token panels behind History / Proxy tokens navigation. Switching disposes the previous panel, aborts reads/mutations and clears displayed bearer secrets. Aborting a mutation does not prove it failed or revoke a token.
- Any current-child 401/403 clears the whole operations mount, downloads and navigation. Retained controls and late responses cannot revive it. Caller MUST dispose on logout, known expiry or identity change.
- No credentials, grant acquisition, CSRF/IdP/session decision, API, IAM, persistence, public entry or automatic mutation change. This is an explicit trusted-caller adapter, not installed login acceptance.

## Design
- New operations-app.ts composes mountHistoryWorkspace and mountTokenManagementPanel. Accept already-authorized CatalogRequest plus a factory for a fresh caller-owned HistoryDownload per history visit. Epoch checks stop detached controls/requests; current 401/403 is terminal globally. Factory failures show a generic unavailable view with navigation still usable.
- Prefer disposal/remount over keeping hidden token secrets or active background requests. No new domain terms or ADR. Existing server authorization/audit remain authoritative.
- Dependency: trusted session integration and deployment remain owned by frontend/backend/infrastructure. Existing source files are untouched to avoid concurrent work.
- Contract: contracts/management-operations.md; PRD/architecture/acceptance additions.

## TDD plan
- Baseline inert mount must fail assertions for actual history GET and navigation, not missing imports.
- Cover real existing clients/panels, token confirmation POST, secret clearing on navigation, abort/late responses, terminal 401/403 from both panels, adapter failures, stale controls and idempotent teardown. Build through canonical browser builder.
- Run focused Node tests, TypeScript, Biome, planning and compatibility; attempt full npm check and keep environment failures explicit.

## Delivery
- Separate worktree, issue branch, DCO and AI disclosure; exact-head CI plus valid formal approval before merge.
- Rollback removes additive mount; no persisted state. Native browser preview and installed SSO/provider acceptance are separate evidence.

## Verification checkpoint
- Baseline inert mount: 0/8 pass, eight behavior failures (missing GET/navigation/terminal handling/browser implementation), not missing imports. A separate reentrant cleanup regression failed 1/9, then passed after guarded cleanup.
- Focused operations/history/token-panel regression: 39/39 pass, zero skipped. Canonical browser bundle is exercised by the operations tests.
- Full TypeScript exit 0; changed-file Biome, planning links/contracts and six pinned compatibility checks pass.
- Native browser at http://127.0.0.1:18802 uses clearly marked synthetic responses: initial usage GET, token confirmation POST, return to history, then a 403 removes the entire operations navigation. No real token or live mutation is issued.
- Aggregate npm check exits 7 before scripts: installed npm cannot resolve walk-up-path. Broad management regression remains separately recorded; no aggregate/full-suite success claim.
- No installed SSO/database/provider/production acceptance. Exact-head CI and valid formal approval remain merge gates.
