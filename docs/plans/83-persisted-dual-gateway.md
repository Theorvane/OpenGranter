# Persisted dual-route gateway composition

## Issue and problem

- Issue: [#83](https://github.com/Theorvane/OpenGranter/issues/83).
- The PostgreSQL direct gateway composes stored registrations, but deployments still manually supply the OpenRouter invoker and verified mapping resolver.

## Scope and expected behavior

- Add asynchronous dual-route handler and unbound Node server factories that compose stored direct registrations, verified OpenRouter mappings, and the existing OpenRouter adapter.
- Both route kinds share the existing proxy-token authentication, current IAM, limits, audit, and usage paths. Stored delegated routes provide the secret reference and model; only IAM-eligible verified provider slugs are sent upstream.
- Reuse injectable transport/timeout and optional Jev port. Construction loads direct registrations but retrieves no secrets and performs no upstream call.
- Preserve existing custom-invocation/direct factories. No new HTTP fields, route switching, migration, automatic listening, connection ownership, environment reads, SSO, or public management API.
- Caller applies all bundled migrations, owns the connection and HTTP lifecycle, and supplies real secret and limit implementations.

## Design

- `createPostgresDualRouteChatHandler` reuses `createPostgresDirectChatHandler`, injects the per-call PostgreSQL verified mapping resolver, and constructs the fixed-host OpenRouter invoker using each trusted route's credential reference.
- `createNodePostgresDualRouteChatServer` exposes that handler through the existing Node request bridge.
- Direct registrations retain construction snapshot semantics; mappings read current state per call. Neither changes the existing authorization/routing contracts.
- Optional infrastructure transport/timeout settings apply to both provider adapter families. Adapter defaults remain unchanged when omitted.
- Keep SSO, public management, deployment runtime selection, policy scoring, streaming, and audit retention decisions open.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and the [composition contract](../../contracts/persisted-dual-gateway.md).

## TDD plan

- First socket integration test imports the absent dual server factory and expects module-not-found before implementation.
- Apply the bundle, seed direct/delegated catalog routes and persisted IAM/mapping configuration, issue one token, and call both aliases through fake fixed-host upstream transport. Inspect normalized metadata and usage/audit without secrets/content.
- Verify provider Deny, missing/disabled mappings, limits, missing secrets, upstream errors, audit write failures, revocation, and registration-load failures prevent inappropriate external calls. No delegated failure falls back to direct inference.
- Test delegated-only construction with no direct registrations. Keep optional Jev forwarding by reusing the existing direct composition path.
- Implement only composition and the server wrapper; format, run focused tests, and run `npm run check`.

## Delivery

- Record issue/plan and contracts; capture red/green evidence; validate; publish a ready PR.
- Rollback uses the existing factories with explicit upstream ports. There is no new schema/data change.
- Report trusted infrastructure configuration, migration/lifecycle ownership, registration snapshot limitations, and remaining runtime integration in the PR.

## Verification evidence

- Red: `node --experimental-strip-types test/postgres-dual-http-server.test.ts` failed with `ERR_MODULE_NOT_FOUND` before the dual server factory existed.
- Green: the same command passed all 4 socket/boundary tests. The tests use existing HTTP error statuses and camel-case stored usage fields; no product error or ledger contract changed.
- `npm run check` passed TypeScript strict checking, Biome, 316 tests, and planning/link/contract/fixture checks. One external PostgreSQL test was skipped locally without a database URL; CI supplies PostgreSQL. Embedded PostgreSQL/socket cases passed.
- `git diff --check` passed. No migration changed, and `CLAUDE.md` remains linked to `AGENTS.md`.
