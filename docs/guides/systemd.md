# Optional systemd service

For Linux systems with systemd, [the unit](../../deploy/systemd/opengranter.service) supervises the existing gateway executable. It is opt-in packaging, not an installer, readiness protocol or tested production deployment. [Service prerequisites and bootstrap contract](service.md) still apply. AWS/on-prem release order remains unresolved.

## Prepare a release

1. Install Node >=22.14 at `/usr/bin/node`, or override `ExecStart` with its absolute path (reset the original `ExecStart=` first). Check the actual version before starting.
2. Provision a dedicated unprivileged `opengranter` user/group with no interactive login. Do not reuse a developer or database account. The unit does not create accounts.
3. Stage a root-owned release at `/opt/opengranter` containing source, scripts, migrations, package files and locked production dependencies (`npm ci --omit=dev --ignore-scripts`). Do not run installation or lifecycle scripts from the unit. The service account must read the release but never write it or its parent directories. Build away from the running immutable release.
4. Create root-owned `/etc/opengranter` and the trusted `bootstrap.mjs` described in the service guide. The account must traverse this directory and read the module and any referenced nonsecret files, but must not write them. Use absolute imports into `/opt/opengranter/src/` for runtime factories; relative imports resolve from the bootstrap file, not the working directory. Return factories/resolvers; provision a real secret manager and limits service explicitly.
5. Create required `/etc/opengranter/gateway.env`, owned by root with mode0600. It may be empty to retain unit defaults, or contain nonsecret configuration and credential references required by the trusted module. This is systemd environment-file syntax, not a shell script: do not use `export`, command substitution or shell expansion. Never place provider keys, passwords or secret connection strings in it; process environments are not a secret store. Use deployment-managed protected files or secret-manager integration in the bootstrap. Grant the service account only needed access. `ProtectHome=yes` makes home-directory credential files inaccessible.

Default listener is loopback8080. Explicit environment-file settings override the unit's defaults. If overriding `OPENGRANTER_SHUTDOWN_MS`, also set `TimeoutStopSec` to a greater duration using a root-owned drop-in. A public bind, ingress/TLS, egress, database access/migration permissions and environment-specific controls are operator decisions, not automatic configuration. `network-online.target` does not prove PostgreSQL is reachable.

## Validate and start manually

After preparing the above paths and account, as an authorized administrator:

```sh
sudo install -o root -g root -m 0644 deploy/systemd/opengranter.service /etc/systemd/system/opengranter.service
sudo systemd-analyze verify /etc/systemd/system/opengranter.service
sudo systemctl daemon-reload
sudo systemctl start opengranter.service
sudo systemctl status opengranter.service
```

Inspect fixed gateway startup diagnostics in the journal. `Type=simple` and a successful `systemctl start` only indicate process launch, not completed migrations/listening or continuing readiness. Verify `Gateway listening` and perform environment-specific HTTP acceptance. A startup-only unauthenticated probe can check401 at `/api/v1/models`; it does not validate provider access, IAM/quota success or persistence. Only enable boot startup (`systemctl enable opengranter.service`) after your deployment acceptance, not as part of installation by default. Avoid exporting raw journal content: trusted bootstrap/dependencies may emit their own sensitive logs.

The unit restricts filesystem writes with `ProtectSystem=strict`, hides home directories, provides private temporary space, drops capabilities and forbids privilege elevation. It does not deny networking or Node JIT, supply a secret sandbox or harden arbitrary trusted bootstrap code. Any additional writable path must be an explicit least-privilege operator override. Test adapters against these restrictions; do not silently remove hardening to get startup to pass.

## Stop, failure and rollback

`systemctl stop opengranter.service` sends SIGTERM to the service control group. Node is launched directly; the existing application drains HTTP before closing PostgreSQL within its default30-second deadline. The default systemd40-second stop grace permits that deadline before forced kill. A hung synchronous module still requires the external supervisor. Deadline/forced termination may interrupt accounting; exit0 alone does not certify recovery.

`Restart=no` is intentional. Investigate startup or persistence failure and restart manually only after acceptance. Never automatically replay potentially billed requests. Stop the old unit before switching a release, then start and verify the replacement. Rollback to the previous immutable release and unit/drop-in after stopping; committed database migrations are not rolled back. Backup/restore, reconciliation, real secret/limit adapters, load and SSO lifecycle remain separate work.

CI performs static unit verification; local packaging/process tests do not run a systemd host. Actual host identity, permissions, Node version, dependency compatibility, stop behavior and provider/database connectivity must be validated by the deploying operator. See [plan](../plans/570-systemd-service.md).
