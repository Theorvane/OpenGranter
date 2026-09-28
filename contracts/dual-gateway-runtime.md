# Owned dual-route gateway runtime contract

`startPostgresDualRouteGateway(ports)` opens and owns a PostgreSQL connection and HTTP listener. `startPostgresGateway` remains available for direct composition and optional custom delegated ports; both use the same lifecycle implementation.

- Trusted infrastructure supplies `host`, `port`, `openConnection`, `now`, `newRequestId`, `checkLimit`, `resolveSecret`, and optional `fetcher`, `timeoutMs`, `fetchJev`, and `migrationDirectory`. There is no public server-builder override or caller routing configuration.
- Validate host/port before source/DB work. Load the complete bundled SQL before opening DB. Verify/apply migrations before registration loading, composition, or listening. No secret lookup or upstream call occurs during startup.
- Successful startup returns a copied bound address and `close()`. The dual composition supplies persisted direct adapters and the verified OpenRouter mapping/invoker automatically, sharing existing token/IAM/limit/audit/usage boundaries.
- Startup failures expose `GatewayStartupUnavailable`, attempt to close owned resources, and retain no driver cause. Invalid bind inputs expose `InvalidGatewayRuntimeInput` before connection opening.
- `close()` always returns the same promise, stops new HTTP acceptance, waits for active HTTP work, then closes DB exactly once. Cleanup failure exposes fixed `GatewayShutdownUnavailable` and is not automatically retried.
- No new schema, default network bind, CLI/environment parser, process-signal handling, TLS, or shutdown deadline is supplied. Operators still serialize migration startup and supply secret/limit implementations.
- Direct registration changes require reconstruction. Mapping changes after a lookup are not revalidated; shared lifecycle introduces no transaction across requests/configuration.

## Executable cases

`test/postgres-gateway-runtime.test.ts` runs the lifecycle contract against both public wrappers and checks fresh-migration dual-route inference through the socket with fake upstream transport.
