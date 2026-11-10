# Stable audit review scope

## Issue and problem

Issue #642, parent #637. The production audit SQL reader reads caller-owned filter and limit values again after awaiting SQL. Mutating those values can reject valid rows, alter keyset lookahead, or accept substituted rows under a different principal/filter scope.

## Scope and expected behavior

1. Capture the scalar principal, limit, cursor, model, request and time fields before validation and SQL.
2. Use the owned request for SQL parameters, returned-row validation and page/cursor construction.
3. Preserve fresh service IAM, required access audit, content-free projection and existing endpoint/schema contracts.

## TDD plan

Reproduce pending-query mutation using deterministic SQL gates: valid original rows must remain valid; substituted foreign-scope rows must fail; original page size and cursor must survive mutation. Run meaningful RED before changing production. Add migrated PGlite concurrent-principal acceptance, then run bounded serial reader, SSO HTTP and filter regression tests plus typecheck, lint, planning and diff checks. CI runs the full required check suite.

## Delivery and boundaries

This is a production reader correction on the existing integrated review feature line, not a remote-browser object mutation exploit or a new session API. No FE-owned files, BFF/session, schema, listener, provider or deployment changes. Require exact-head CI and independent formal approval before merge. PGlite is not installed PostgreSQL; browser login and full PRD delivery remain open. Rollback: revert this bounded change.
