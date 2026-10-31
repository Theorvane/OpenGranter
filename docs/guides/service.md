# Run the gateway service

This execution adapter starts the persisted direct/OpenRouter chat runtime. It does not configure an organization, seed permissions, issue proxy tokens, enforce a built-in quota, expose SSO management, or provide complete production deployment configuration.

## Prerequisites

Use Node >=22.14, `npm ci`, PostgreSQL with migration permissions, and administrator-provisioned identities, routes and provider registrations. The runtime applies bundled migrations under its existing serialized migration boundary before listening. Use a disposable database for experiments.

Create an absolute, deployment-owned ESM module exporting `createGatewayPorts`. Its return value must implement `GatewayBootstrapPorts` from `src/gateway/gateway-service.ts`. Required ports are:

- `openConnection`: create a fresh owned `PostgresConnection`, for example with `createPostgresConnection` and deployment-supplied PostgreSQL configuration.
- `resolveSecret`: resolve only administrator-configured credential references through your secret manager. Do not store raw keys in the module, repository or command line.
- `checkLimit`: your explicit limits service. Do not substitute an always-allow function for production enforcement. A deny-all implementation is appropriate for a startup-only probe.

Optional runtime ports (such as upstream timeout/fetcher or migration directory) retain their existing contracts. Do not acquire resources inside the factory: return factories/resolvers; the gateway owns only the connection returned by `openConnection` and its HTTP server. Extra resources, logging and any code executed by imports remain the module author's responsibility. The module and its parent directories must not be writable by untrusted users. This is trusted executable code, not a sandbox or client-uploadable configuration.

```sh
OPENGRANTER_BOOTSTRAP_MODULE=/etc/opengranter/bootstrap.mjs npm start
```

| Variable | Default | Validation |
| --- | --- | --- |
| `OPENGRANTER_BOOTSTRAP_MODULE` | required | Absolute filesystem path, not a URL; named factory required |
| `OPENGRANTER_HOST` | `127.0.0.1` | Nonempty, <=253 characters, no whitespace/NUL; OS validates bind address |
| `OPENGRANTER_PORT` | `8080` | Decimal integer 1..65535 |
| `OPENGRANTER_SHUTDOWN_MS` | `30000` | Decimal integer 1..2147483647 |

Configuration is checked before importing the module. The executable overrides any module-supplied host, port, clock or request-ID generator. Invalid bootstrap ports stop startup rather than silently disabling secrets/limits. Existing IAM, audit and usage behavior is unchanged. No provider requests are made just to start the process.

## Process supervision

For a container/service supervisor, launch Node directly so the gateway is the signal target (npm signal forwarding is not a deployment guarantee):

```sh
exec node --experimental-strip-types scripts/start-gateway.ts
```

Provide the same environment and run from the release root. Protect ingress with the deployment's TLS/network controls. Loopback is the safe default; binding publicly is an operator decision. A fixed `Gateway listening` message means startup/listen completed, not an ongoing readiness check.

SIGINT/SIGTERM records one shutdown intent. A signal during module loading or factory resolution prevents later startup where possible; a runtime already starting is closed once it returns. HTTP drains before PostgreSQL closes, using existing runtime ownership. One referenced deadline covers pending startup and draining; repeated signals neither restart it nor duplicate cleanup. The process stays alive while bootstrap is pending so signals remain effective.

Success exits 0. Configuration/startup/close failure or deadline expiry exits 1 with fixed diagnostics; thrown objects, stacks, module paths and connection strings are not printed by the runner. Trusted bootstrap code can itself log or terminate the process and must follow the same secret rules. Deadline expiry forces process termination, can interrupt in-flight persistence, and does not prove successful cleanup. Supervisors should allow more than the configured deadline before sending SIGKILL. An unresponsive synchronous module blocks the event loop, so an external supervisor remains necessary.

Startup cleanup may not undo committed migrations. Never automatically replay possibly billed requests after forced shutdown. Backup/restore, accounting recovery, readiness, vendor secret adapters, real quotas and the separate SSO lifecycle remain additional deployment work.

See [service contract](../../contracts/gateway-service.md) and [plan](../plans/564-service-entrypoint.md).

An optional non-root image and explicit networking/mount/stop instructions are in the [container guide](container.md); packaging does not settle these remaining deployment requirements.
