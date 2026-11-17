# Cancel inactive history work (#642)

## Issue and problem
- Issue: #642, parent #637.
- History tab switches leave outgoing JSON/CSV work running. A late CSV can invoke the download adapter after its screen has been left.

## Scope and expected behavior
- Cancel outgoing local work when changing Usage/Audit tabs. Suppress late data, errors and CSV delivery using existing review cancellation.
- Retain applied filters and page navigation; returning performs the existing fresh authorized read. Ready/empty pages without pending work are unchanged.
- No new endpoints, identity/session decisions, grants, writes, migrations, retention, provider calls or public-entry activation. Cancellation cannot undo server processing or audit.

## Design
- Change only the history mount navigation handler: cancel previous review before selecting target, then perform existing target refresh; cancellation notifications must never render a cached destination ahead of its fresh authorization. Check the identity lifetime after cancellation notifications.
- Reuse review cancellation rather than duplicate transport revision logic. No open security decision is resolved by this local fix.
- Documents: docs/PRD.md, docs/architecture.md, docs/acceptance.md, contracts/management-history-workspace.md.

## TDD plan
- RED: public DOM tab switches must abort the outgoing request; current mount does not.
- Cover both directions, stalled JSON, pending CSV headers and body, late completion/denial disposal, same-tab no-op, return refresh with retained filters, terminal denial and disposal.
- GREEN: smallest mount change; run mount/workspace/session/build regression tests, strict typecheck/lint, planning checker and npm run check.

## Delivery
- Stack on #975 (exact 29fbac1); parent must satisfy its merge gates first.
- Report RED/GREEN and CI/review evidence separately. No installed/browser/IdP/provider success inferred from DOM/HTTP tests.
- Rollback removes outgoing cancel wiring; server authority and data formats are unchanged.
