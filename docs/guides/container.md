# Gateway container deployment

This optional image packages the existing [service executable](service.md). It is not a turnkey production installation. Organization provisioning, IAM, routes, real quota enforcement, secret-manager integration, TLS, SSO, readiness, backup/recovery and load acceptance remain deployment responsibilities.

## Build and release

Use Docker with a Linux container engine from the repository root:

~~~sh
docker build --pull --tag opengranter:local .
~~~

The official Node22 bookworm-slim base tag follows security updates and is mutable. Resolve and record the base and resulting image digests for each deployment; rebuild and scan on your release schedule. A package lock is not a complete reproducible/signed supply-chain guarantee. CI smoke-tests the native runner platform only; other architectures require their own validation.

Only package metadata, runtime source, bundled SQL migrations and the executable enter the build context. No development dependencies, repository metadata, tests, local environment files or bootstrap are copied into the runtime image. Keep credentials outside these allowlisted source files too: the context filter cannot detect secrets accidentally placed in source. Dependencies are installed from the lock without lifecycle scripts. Application files remain root-owned; the process runs as the official image node user (uid1000). No runtime package installation is supported.

## Required deployment bootstrap

Supply a trusted, administrator-owned ESM module exporting createGatewayPorts as described in the [service guide](service.md). Return explicit PostgreSQL connection, secret resolver and limits ports; no permissive implementation is bundled. In-container imports must use container paths, for example /app/src/storage/postgres-connection.ts for the connection helper. An externally mounted module does not resolve /app/node_modules through ordinary bare imports: use absolute imports or separately provision its dependencies. Mount any extra configuration/secrets read-only and make them readable only by the required runtime identity. Never bake raw credentials into an image or pass them on the command line.

Example invocation assumes /etc/opengranter contains the deployment-owned module and any required read-only configuration, with appropriate traversal/read permissions for uid1000:

~~~sh
docker run --name opengranter --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --stop-timeout 40 \
  --publish 127.0.0.1:8080:8080 \
  --mount type=bind,src=/etc/opengranter,dst=/bootstrap,readonly \
  --env OPENGRANTER_BOOTSTRAP_MODULE=/bootstrap/bootstrap.mjs \
  --env OPENGRANTER_HOST=0.0.0.0 \
  --env OPENGRANTER_PORT=8080 \
  --env OPENGRANTER_SHUTDOWN_MS=30000 \
  opengranter:local
~~~

The explicit wildcard bind is needed inside the container for bridge port publication. The image does not change the executable loopback default. The published port above is host-loopback only; ingress/TLS/firewall configuration is separate. Container localhost is not the host database: configure a reachable administrator-approved database hostname in your bootstrap. Do not use the CI test database trust configuration in production.

The image launches Node directly as PID1 and uses SIGTERM. Allow an external stop timeout greater than the configured shutdown deadline (40s vs30s above); increases to one must be reflected in the other. The reference bootstrap must not require child-process reaping. If your trusted bootstrap spawns children, supply a suitable init/supervisor and verify signal forwarding. No automatic restart policy or healthcheck is installed. A listening log is not ongoing readiness.

The read-only filesystem and dropped capabilities are deployment flags, not protections enforced by the image against a privileged operator. Bootstrap integrations needing writable state require explicitly scoped mounts; never make application code writable. Extra module-owned resources remain its responsibility. No traffic or production resources are created by this guide.

## Validation and recovery

The Container workflow builds the image, checks uid/runtime dependencies/migrations and absence of development files, verifies failure without bootstrap, then starts a disposable PostgreSQL-backed gateway using test-only deny-all ports on a read-only filesystem. Independent host and bridge matrix cases exercise the loopback default and explicit wildcard listener with host-loopback port publication respectively; the bridge case connects to the disposable database on its Docker network. An unauthenticated compatible model request must return401; SIGTERM must exit0 before the external stop deadline. The #633 follow-up restarts the same gateway against the same database, repeats the HTTP probe and checks an inert disabled catalog row and exact migration history. This does not restart the database or validate volume recovery. This does not test real credentials, authorized provider calls, external exposure, readiness, quota correctness, load or recovery.

Stop with docker stop; do not replay possibly billed requests after forced termination. Reverting an image does not revert committed database migrations. Back up and test restore using your database procedures before production changes. See [contract](../../contracts/gateway-service.md) and [implementation plan](../plans/566-container-packaging.md).

Bridge CI follow-up: [plan](../plans/568-container-bridge-smoke.md). Local Docker verification is not claimed; inspect exact-head CI results before deployment.

For the bounded installed-host and real-client/provider gates, use the [limited bridge acceptance checklist](limited-bridge-acceptance.md). No live acceptance is implied by CI.
