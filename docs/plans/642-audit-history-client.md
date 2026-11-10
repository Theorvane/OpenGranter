# Bounded audit history client

## Issue and problem
- Issue #642, parent #637. Audit HTTP metadata exists but has no browser transport.

## Scope and expected behavior
- Read one explicitly selected principal through existing /v1/audit JSON with time/model filters and decimal event-ID pagination.
- Validate and reproject every response; never expose arbitrary event fields, server error bodies or retained content. No billing transformations.
- Inject trusted authorized request port. NOT SSO authentication or a new management endpoint. Host owns credentials, identity, expiry and invalidation. No runtime activation or frontend navigation changes.

## Design
- Reuse existing pure audit query/page projection. Bounded UTF-8 streaming, no-store requests, fixed same-origin path, timeout and cancellation.
- Require explicit target principal to validate isolation; server IAM remains authoritative. Copy filters before awaiting.
- Alternatives: inventing SSO audit endpoint rejected pending backend ownership/contract. Frontend owned files untouched.
- Session/IdP/BFF and content retention decisions remain open. Update PRD, architecture, acceptance and audit browser contract.

## TDD plan
- RED missing public client module. GREEN success/empty, pagination, decimal precision, filters, private projection, malformed response, denial, failed audit, bounded bytes, invalid UTF-8, cancellation and stale reads.
- Exercise existing real Fetch handler for IAM and mandatory audit paths, separately from installed/SSO/browser evidence.
- Focused tests, typecheck, lint, planning checker, compatibility and standard full check.

## Delivery
- Independent branch off main, draft PR, exact-head CI and independent formal approval before merge.
- Remove client to roll back; no migration. No provider/paid/production calls.

## Evidence
- RED missing public module in /tmp/og-0230-audit-red.log. GREEN 43/43 zero skipped in /tmp/og-0230-audit-green.log, including 11 new client tests and real Fetch handler plus migrated PGlite composition, fresh permission revocation, durable read/deny audit, failed audit and private fields. No actual browser, installed PostgreSQL or SSO/provider acceptance claimed.
- Typecheck and lint pass (existing 42 warnings/161 infos). No frontend-owned files changed.
- Planning/secret scan, all six offline compatibility pins, diff check and browser esbuild bundle (20.7 KiB) pass. Standard npm run check running at /tmp/og-0230-fullcheck.log with one-CPU affinity to bound concurrency; no full-pass claim until summary.
