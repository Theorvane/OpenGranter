# Usage review screen coordinator (#642)

## Public behavior

The additive createUsageReview(request, onChange?) module accepts an already-authorized signed-SSO request port. It does not authenticate, authorize locally, store credentials or activate a browser entry. Callers must dispose on identity change or expiry and create a new coordinator from the trusted session adapter.

- load(filters) captures known filter values once and starts a new search. It discards supplied cursors and resets backward history.
- next() and previous() use only successful page cursors, retaining exact keyset strings and the same filters. They do nothing during loading or when navigation is unavailable. No automatic history aggregation.
- retry() repeats the current attempted request, including a failed next page.
- snapshot() returns deeply frozen loading/ready/empty/idle or safe client failure, current page rows, next/back availability and export status. Loading and failure snapshots hide old rows.
- exportCsv() explicitly requests only the displayed page with identical filters and current cursor; returns existing bounded server CSV without reconstructing rows or automatically downloading. Success leaves no CSV in the snapshot. Transport failure preserves the authorized page; authentication/denial clears it.
- New searches, navigation, overlapping exports and dispose cancel superseded work. Stale operations cannot publish or return successful CSV after the page/identity changes, even if a rendering observer disposes synchronously.
- A 401/403 from JSON or CSV clears rows and pagination, cancels work and permanently blocks port reuse. Trusted recovery requires a new instance. dispose() is terminal, returns to idle and clears data. Observer exceptions cannot interrupt teardown or disclose diagnostics.

## Contract cases and evidence

Loading, ready/empty, exact opaque keyset next/back, filter reset, failed-next retry, single-read getters, private metadata projection, immutable snapshots, CSV filter parity, CSV failure, denied/expired requests, supersession, uncooperative requests, disposal and observer exceptions are exercised through the public coordinator and existing clients. Signed-SSO Fetch integration over migrated PGlite verifies pagination, explicit CSV, filtered empty state, mandatory durable access audit, and fresh Deny. PGlite and Fetch evidence is not installed PostgreSQL, native browser or IdP evidence.

Server IAM, metadata redaction and mandatory access auditing are unchanged. Canonical browser build currently needs a separately reviewed pure-shared module integration for the underlying clients. This module adds no DOM/builder/session/CSRF/IdP/IAM/retention/schema/provider/deployment authority; rendered UI and live acceptance remain separate gates.

Usage rows preserve validated exact costComparison, original estimate/report strings, unknown token availability and independent duplicate/billing markers. No fabricated zero/totals or reconciliation. JSON uses /management/v1/usage; CSV uses /management/v1/usage via its existing transport. Only format differs.
