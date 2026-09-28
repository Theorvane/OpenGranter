# Owned dual-route gateway runtime

## Issue and problem

- Issue: [#87](https://github.com/Theorvane/OpenGranter/issues/87).
- The owned runtime builds only the direct composition. Deployment callers must still provide delegated ports manually despite the persisted dual handler/server now being available.

## Scope and expected behavior

- Add `startPostgresDualRouteGateway` with trusted DB opening, host/port, clock/request IDs, limits, secret resolution, optional transport/timeout/Jev settings, and optional migration bundle directory.
- Reuse the owned lifecycle: validate bind input, load the complete bundle, open DB, verify/apply migrations, build persisted dual composition, then listen.
- Return address and one shared shutdown promise; close HTTP after active work completes, then DB. Startup failures attempt cleanup and expose fixed errors.
- Existing `startPostgresGateway` retains direct/custom optional delegated behavior. Both wrappers share lifecycle implementation and contract tests.
- No new schema, HTTP field, routing boundary, CLI/environment defaults, process signals, TLS, shutdown deadline, SSO, public management, or live reload.

## Design

- Extract a private lifecycle helper taking trusted runtime infrastructure and a connection-to-unbound-server builder. Move schema application into the shared helper before either composition.
- Keep public wrappers explicit: the existing wrapper builds direct composition; the new wrapper builds persisted dual composition. Neither allows a caller-supplied runtime server builder.
- The dual wrapper supplies generated OpenRouter invocation/mapping ports through the existing dual factory. Direct registration snapshot and per-call mapping behavior remain unchanged.
- Keep limits/secret implementations and deployment configuration injectable. Serialize migrators operationally as before; no new concurrent startup guarantee.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [runtime contract](../../contracts/dual-gateway-runtime.md).

## TDD plan

- Run the shared lifecycle tests against both named public runtimes. Before implementation, the new export should be absent.
- Preserve success, invalid input/source, open/migration/configuration/listen failure, shared safe shutdown failure, and active-request drain coverage.
- Add a dual runtime integration case that starts from fresh migrations, seeds trusted catalog/IAM/provider/mapping configuration before registration loading, issues a token, and invokes both routes through one socket with fake transport.
- Verify all migrations precede configuration, no secret/upstream work occurs during construction, history persists, and final close owns DB exactly once.
- Implement the minimal shared lifecycle and dual wrapper; format, run focused tests, then `npm run check`.

## Delivery

- Record issue/plan before code; capture red/green and full-check evidence; publish a ready PR.
- Rollback uses the existing direct wrapper; there is no schema/data rollback. Shared lifecycle extraction must retain prior ordering and error contracts.
- Report operator-controlled configuration, secret/limit implementations, migration serialization, and existing shutdown/reload limitations.

## Verification evidence

- Red: `node --experimental-strip-types test/postgres-gateway-runtime.test.ts` failed because the new dual runtime export did not exist.
- Green: the same command passed all 19 shared lifecycle and dual socket cases.
- Initial `npm run check` passed TypeScript strict checking, Biome, 327 tests, and planning/link/contract/fixture checks. One external PostgreSQL case was skipped locally without a database URL; CI provides PostgreSQL. Embedded PostgreSQL/socket cases passed.
- `git diff --check` passed. No migration change; `CLAUDE.md` remains linked to `AGENTS.md`.

### Integration after simulator review

PR #86 became approved during implementation and was merged to main. Integrated its simulator code/contracts and preserved both additive documentation sections. The combined `npm run check` passed strict TypeScript, Biome, 332 tests, and planning/link/contract/fixture checks; the same external PostgreSQL case remained locally skipped. Runtime production code was unchanged during integration.
