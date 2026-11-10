# Usage review lifecycle

## Issue and problem
- #642, parent #637. JSON transport exists but the UI lacks a review-page lifecycle.

## Scope and design
- UI-independent read-only SSO usage coordinator. Caller supplies trusted request port; this is not authentication or IAM.
- Authorize starts a fresh epoch. Clear/expiry/dispose abort and remove rows, filters and cursor. Loading removes prior rows. Server IAM is authoritative.
- Search starts at page one. Next uses only current opaque cursor with copied unchanged filters. Pages replace, not append; no previous-page cache or invented billing.
- No DOM, token storage, login, runtime, session contract changes or provider calls. Frontend owns rendering and must clear on identity/expiry changes.
- Depends on #844. Retarget main after it merges; never merge a feature-base PR.

## TDD and acceptance
- RED missing module. GREEN covers idle/empty/rows, pagination, search reset, immutable snapshots, loading, stale completion, denial, unavailable retry, teardown/disposal.
- Full typecheck/lint/docs and focused transport integration. Exact-head CI and independent formal approval before merge. Browser/installed/IdP acceptance separate.

## Rollback and open decisions
- Remove coordinator, no migration. Pending BFF/session/IdP decisions unchanged.

## Verification evidence
- RED missing module: /tmp/og-0130-session-red.log. GREEN39/39 zeroSKIP: /tmp/og-0130-session-green.log (lifecycle7, JSON10, CSV13, persisted dual HTTP9). Includes prior fullcheck SIGKILL file rerun green; does not change earlier fullcheck failure. Full typecheck and focused lint pass.
- Contract: ../../contracts/management-usage-session.md; PRD/architecture/acceptance updated. Reuse transport validation rather than duplicating server IAM.
- Additional real signed SSO/migrated embedded SQL/Fetch durable history7 plus lifecycle7:14/14 zeroSKIP /tmp/og-0130-session-http.log. Full lint existing42warnings162infos; docs and six compatibility pins pass, browser bundle18KiB pass. Standard npm run check is running separately. No full-pass, browser or installed claims.
