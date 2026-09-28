# Own Gateway Startup and Shutdown Resources

## Issue and problem

- Issue: #73
- Existing factories return unbound servers and leave database/listening cleanup entirely to deployment code. Implement a reusable lifecycle boundary over those factories.

## Scope and expected behavior

`startPostgresGateway` validates explicit bind host/port, loads trusted bundled sources, opens one database connection, verifies/migrates schema, composes HTTP, and listens. Return the actual bound address and a shared idempotent `close()` promise. No new request, permission, audit, content, or routing behavior is introduced. Startup never retrieves keys or calls providers.

## Design

Accept existing direct-server ports without a client/source array plus `openConnection`, `host`, `port`, and optional trusted `migrationDirectory`. The connection-opening port can use the existing node-postgres factory in AWS or on-premises deployments. Require an explicit host; port zero supports ephemeral binding. Validate configuration and load sources before acquiring resources. Once returned by `openConnection`, ownership transfers to the runtime, including on startup failure.

Close the HTTP server first, allowing active requests and their audit/storage writes to finish, then attempt database closure. Concurrent/repeated closes share one promise, including a fixed safe rejection if cleanup fails; no hidden retry is introduced. Startup errors become fixed `GatewayStartupUnavailable` errors after attempting owned-resource cleanup. Invalid bind configuration uses `InvalidGatewayRuntimeInput`; shutdown errors use `GatewayShutdownUnavailable`. Never attach driver causes or deployment input.

A small library function avoids choosing a CLI/environment schema, process signal policy, TLS setup, shutdown deadline, or provider/secret/limit implementations. Those remain deployment responsibilities. The runtime uses the existing sequential migrator: operators still serialize startup migrations. Cleanup is an attempt; failure cannot certify released external resources. Earlier committed migrations survive a later startup failure.

See [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). Existing HTTP contract cases remain unchanged.

## TDD plan

Start with public runtime tests failing on the absent module. Test fresh-schema real HTTP authentication denial, shared shutdown and exact closure, an in-flight audit completing before database closure, invalid inputs and source failure before opening, migration failure and occupied-port cleanup, safe connection-open failure, and safe database-close failure. Use controlled clocks, fake external provider ports, and embedded PostgreSQL; no live provider calls. Implement the smallest lifecycle composition, then format and run `npm run check`.

## Delivery

Issue, branch, plan, red evidence, implementation, green evidence, updated documentation, full gate, ready PR. Reverting this library function leaves lower-level factories and applied schema intact. Document no automatic signal handling, TLS, force-close deadline, or concurrent migration guarantee.

## Verification

Completed with the evidence below.

- Red: `node --experimental-strip-types test/postgres-gateway-runtime.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the absent runtime module.
- Green: the same direct command passed all eight new tests after implementation, including real socket binding and active-request draining.
- Initial formatting/full gate rejected a NUL regex under Biome's control-character rule. A string NUL check preserves behavior without suppressing the rule.
- Final `npm run check` passed TypeScript, Biome, 287 tests, and planning/link/contract/fixture validation. One real PostgreSQL integration test skipped locally without its explicit database URL; CI provisions PostgreSQL.
- `git diff --check` passed. Cleanup failure cannot certify external resource release; TLS, signals, shutdown deadlines, and serialized migrations remain deployment responsibilities.
