# Explicit SSO workspace process (#637 / #639 / #643)

The separately invoked `scripts/start-sso-workspace.ts` selects the consolidated workspace artifact bootstrap. It serves Account, scoped model/usage reads and separately authorized credential mutations through their existing fresh SSO/IAM/audit boundaries. It does not turn the existing SSO browser process into a workspace, alter `npm start`, or activate any running service.

## Operator entry (approval required before installation)

1. Build the public artifact separately with `npm run management:build -- src/management/sso-catalog-entry.ts --output /absolute/public/app.js`.
2. Supply a trusted absolute `OPENGRANTER_BOOTSTRAP_MODULE` exporting `createSsoWorkspacePorts`. The factory returns `openConnection`, registered `issuer`, `audience`, public `jwks`, absolute `browserArtifactPath`, and optionally `migrationDirectory`. Use the existing `SsoBrowserBootstrapPorts` type. Keep database secrets inside the connection factory; never put them in the public artifact. A proxy or `createSsoBrowserPorts` factory is deliberately not accepted.
3. After the separate deployment/schema/ingress approvals, explicitly invoke `node --experimental-strip-types scripts/start-sso-workspace.ts` with Node >=22.14. Configuration uses the existing `OPENGRANTER_HOST`, `OPENGRANTER_PORT` and `OPENGRANTER_SHUTDOWN_MS`. Defaults remain loopback, 8080 and 30000ms. Choose an explicit distinct port; the command does not discover or replace other listeners.
4. The process owns host/port/clock/request IDs even if the trusted factory attempts to supply them. `SIGTERM`/`SIGINT` reuse the existing owned HTTP-before-SQL shutdown deadline. Diagnostics are fixed strings, not underlying errors or filesystem paths. Readiness means the listener started, not that every private feature or release gate passed.

This is an **opt-in executable, not installation authorization**. The default migration manifest remains unchanged; it does not install candidate current-principal or usage audit schemas. Missing audit tables return `503 audit_unavailable`, not unaudited private results. A successful startup does not establish schema approval, session/BFF/CSRF/company IdP login, TLS, installed PostgreSQL durability, restart/backup/restore, provider credentials or paid-call approval. It grants no permissions. Schema/retention/session/target decisions and exact-head formal review/CI remain independent gates.

## Evidence boundaries

`test/sso-workspace-process.test.ts` builds the actual public entry, launches the actual executable in a child Node process with a trusted test module and disposable PGlite, fetches exact bundle bytes over loopback HTTP, observes Account/usage fail closed with absent audit tables, and signals `SIGTERM`. SQL close checks the candidate tables were not installed. Configuration failure exits with fixed diagnostics. No private signing key/access token is written to the bootstrap. Unit tests cover wrong-factory rejection, invalid ports, process-owned fields, startup cancellation and sanitized failures. Existing browser service tests protect its unchanged selection.

This is real build/process/HTTP plus embedded database evidence only. It is not native browser rendering, SSO login, installed PostgreSQL or live-provider E2E. Test listeners close; there is no persistent execution URL from these tests. No changes to the existing listener at port 18980 are implied.

## Explicit audit-history writer port

Workspace factories may return an own optional `writeAuditHistoryAccess` function. `SsoWorkspaceBootstrapPorts` and `PostgresSsoWorkspaceBrowserBootstrapPorts` carry the existing runtime writer type through the artifact entry. The service rejects an own undefined/null/non-function value before calling its starter; omission retains audit-route 404. Valid writer references are forwarded unchanged. Inherited properties are not copied by the process boundary and do not activate the route. This changes neither the legacy browser factory nor proxy startup.

The trusted writer must resolve only after durable commit; type/function validation is not approval or a durability proof. No default writer, SQL schema installation, policy grant, session bridge, deployment or paid call is introduced. Loopback tests use signed fixture identity, disposable embedded SQL, actual built asset and an in-memory writer. Native browser/company SSO and installed PostgreSQL durability remain unverified.
