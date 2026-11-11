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

## Exact-page recovery follow-up
- Before production changes, add public-boundary regressions for retry of a failed first page and failed continuation without resetting the user's immutable filters or opaque cursor. Expose an explicit retry command only for transient unavailable state; never automatically repeat requests or retain old rows.
- Keep only the pending query scalars, not previous rows. Clear retry authority on a new search, successful result, invalid query, denial, logout, expiry, reauthorization and disposal. Loading and stale completion rules remain unchanged. This is UI-independent recovery, not a browser session or runtime activation.
- Scope remains the owned usage-session module; frontend's product navigation and session adapter stay untouched. Browser integration and frontend selection remain open.

- 2026-11-11 recovery evidence: initial shell test append failed before edit; old 7-pass run was not RED. Corrected public-boundary RED /tmp/og-0900-retry-red-corrected.log has 7 pass and 3 expected missing-retry failures. GREEN /tmp/og-0900-retry-green-final.log has 42/42 zero skips across lifecycle10, JSON25 and signed SSO/migrated embedded SQL/durable HTTP7. Retry itself is tested through the injected request port; signed SQL transport tests are separate, not browser acceptance. Full typecheck, lint (42 preexisting warnings/162 infos), docs, six compatibility pins and diff pass.
- Rebased onto merged #844 (main6757eee); dropped superseded predecessor61677b8 after inspecting conflicts and retained both pending-request snapshot and lifecycle acceptance sections. No frontend-owned file changed. Standard full check remains a separate gate; exact-head CI/formal review and frontend selection remain required before activation.
