# Read Published Model Routes from PostgreSQL

## Issue and problem

- Issue: [#43](https://github.com/Theorvane/OpenGranter/issues/43)
- The gateway lists and resolves trusted routes only through injected ports; no PostgreSQL catalog reader supplies those ports.

## Scope and expected behavior

- Add a versioned migration for aliases and route snapshots. A model points to one active route snapshot. Previous route rows can remain for operational history, but this reader returns only the active route. A disabled alias resolves to no route.
- A read-only adapter supplies `listPublishedModels` and `resolveRoute`. Managed and delegated snapshots carry ordered candidates; delegated routes carry a server-held credential reference, while managed routes carry explicit Jev configuration. No secret value or arbitrary host is stored.
- Reject malformed, duplicate, incomplete, oversized, or inconsistent rows as a whole with a fixed safe error. Missing or disabled aliases return no route; an invalid enabled route fails closed. Catalog listing is bounded to 1000 aliases.
- Out of scope: admin mutation API, publication transaction workflow, health and scoring, verified provider-slug mapping, and deployment connections. One active route per alias is a storage publication mechanism for this slice; multi-route selection remains unresolved.
- No policy or usage semantics change. The existing gateway still applies IAM, limits, audit, and usage when it consumes the adapter.

## Design

- Store model publication state in `catalog_models` and route snapshots in `catalog_routes`, using a foreign key from the model's active route ID to a route for the same alias. Insert a model before its routes, then set its active route in one trusted configuration transaction.
- Read a consistent list snapshot with one bounded join query and one alias with a bound parameter. Rebuild only allowlisted TypeScript route and candidate fields. Reject duplicate candidate IDs and mixed route kinds.
- Keep explicit Jev disclosure settings in stored snapshots; do not infer unresolved product defaults from null columns.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and migration tests. No ADR is needed because this is a reversible storage implementation of the existing route contract.
- Open decisions: management API, multi-route selection policy, health/capability refresh, scoring, and Jev product defaults.

## TDD plan

- First add a PostgreSQL-backed test that reads one managed and one delegated published alias and proves ordered candidate projection. Confirm the missing adapter fails red.
- Add unknown/disabled, malformed row, duplicate candidate, oversized list, parameterization, and database-failure tests. Verify the gateway can consume both ports without direct provider access during listing.
- Implement the migration and reader, update migration fixture, run focused tests, then `npm run check`.

## Delivery

- Commit on `feat/43-postgres-model-catalog` with authorized DCO and assistance trailers, then open a ready PR linked to the issue and plan.
- Rollback is removal of the reader wiring and migration in a new forward migration; existing gateway ports can continue using their previous injection. The key risk is accepting malformed configuration, so projection and consistency checks must fail closed.
