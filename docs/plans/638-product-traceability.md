# Product requirement traceability

## Issue and problem

Issue: #638, parent #637. Gateway compatibility and container packaging do not establish original management-product completion.

## Scope and expected behavior

1. Inventory original PRD sections 2-8 against checked-in source, public HTTP, tests, UI and installed evidence.
2. Distinguish internal factories from authenticated public administration APIs. Do not infer CRUD or browser sessions from database tables.
3. Order next contracts and preserve unresolved security decisions as blockers.

## Design

Publish an exact-baseline [matrix](../product-traceability.md). Existing detailed compatibility contracts remain authoritative for their subsets. Reject equating gateway CI with product delivery or exposing internal factories directly to browsers.

## TDD plan

Documentation-only R0: no runtime RED/GREEN claim. Run `python3 scripts/check.py`, `git diff --check` and verify cited paths. Future production slices require numbered English plans and failing acceptance tests before implementation.

## Delivery

Obtain independent backend/architecture review before R0 closure. Record exact-head CI and approval separately. No runtime/dependency/schema/permission changes or installed acceptance claim. Rollback is a documentation revert.

## Review revision

Address backend, architecture and code-review findings on initial head 98d242b: inventory management listener composition, PRD section 6 release gates, pricing/reconciliation implementation versus live gaps, and administrator bootstrap/freshness contracts. Documentation only: no security option approved, runtime RED/GREEN or installed acceptance claimed. Request independent review of the new exact head; prior-head approval is not new-head approval.
