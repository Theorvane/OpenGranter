# Audit model drilldown (#642)

## Problem and scope
Audit metadata displays a model alias but users must retype it to query related audit events. Add a guarded Filter audit for model action only for projected nonempty modelAlias strings. Call the existing /v1/audit reader, retaining submitted principal/time/page size and resetting cursor/history/drafts/CSV. No new endpoint, IAM scope, session, content retention, DDL or deployment.

## Design and boundaries
Use the existing guarded button and load path; the audit client and server remain authoritative. Events without a model alias have no action. Treat aliases as inert text and encode query values exactly. Client-only filtering cannot retrieve related events beyond this page. Owner session/ingress decisions remain open and unchanged. See contracts/audit-model-drilldown.md and existing PRD/acceptance/architecture scope.

## TDD and delivery
First source/artifact tests must fail on the missing action. Cover submitted scope, pagination reset, revoked CSV/continuation, draft synchronization, stale/renewed/expired/disposed actions, denial and late responses. Run focused audit/usage suites, typecheck/lint and full check. Open a stacked PR with exact-head CI and independent formal review; no merge without ancestor gates. Native browser, installed PostgreSQL and live SSO remain separate acceptance.

## Evidence

- Meaningful RED: source/artifact each fail because Filter audit for model is absent (2 failures). Initial test setup errors correctly rejected unsupported metadata identifiers and were fixed before the meaningful RED; audit accepts its existing strict identifier vocabulary, not arbitrary markup aliases.
- Focused GREEN: 36 tests passed, zero failed/skipped. Includes source/artifact action lifecycle, allowlisted/non-model metadata and real local HTTP with migrated PGlite, fresh IAM checks and mandatory persisted audit; denial precedes database read with no fallback. Authentication in that HTTP test is an injected test port, not live SSO.
- Typecheck, targeted Biome and planning/diff checks passed. Full check is running; CI/formal review are not yet established.
- Native browser navigation and desktop observation both failed because this Team Computer screen is still being released. No browser/login/install success is claimed.
