# Gateway service execution contract

- Validate required absolute bootstrap path, listener and bounded positive shutdown milliseconds before importing deployment code. Defaults: loopback, port 8080, 30000ms drain.
- Require a named factory and explicit connection, secret and limit functions. Never infer allow-all limits, credentials or SSO configuration. Executable-owned host/port/clock/request IDs override extra module properties.
- Register SIGINT/SIGTERM before dynamic bootstrap import. A first signal initiates one deadline across startup and shutdown. Later signals do not reset the deadline. Stop before runtime creation when possible; close a late runtime exactly once.
- Runtime continues owning migrations, HTTP drain, then database cleanup. Clean completion exits 0; invalid configuration, startup/shutdown failure and expired deadline exit 1 with fixed, secret-free messages. Bootstrap is trusted code, not sandboxed.
- Deadline expiry is forced process termination, not confirmation of completed audit/usage persistence or database cleanup. The executable cannot bound synchronous event-loop blockage; deployment supervisors must provide an external kill deadline.
- No new authorization bypass, permissive quota default, provider call on startup, storage schema, SSO listener or request compatibility change.

Verification: [boundary tests](../test/gateway-service.test.ts), [actual process/socket tests](../test/gateway-service-cli.test.ts), [plan](../docs/plans/564-service-entrypoint.md). Deployment prerequisites and limitations are in the [service guide](../docs/guides/service.md).
