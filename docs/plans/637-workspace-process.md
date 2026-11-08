# Workspace operator process (#637 / #639 / #643)

1. Keep existing proxy and SSO browser executables/defaults unchanged. Add a separately invoked workspace executable, never an environment-selected upgrade.
2. Require an explicit createSsoWorkspacePorts trusted module export with existing artifact/SSO/database ports. Reuse browser-port validation and the owned process lifecycle; host, port, clock and request IDs remain executable-owned.
3. Default to the actual workspace artifact bootstrap, including committed identity audit and existing usage/catalog/credential authorization. No session authority, schema installation, IAM grants or provider calls.
4. RED: tests fail because workspace service does not exist. GREEN: factory isolation, validation, lifecycle override prevention, startup cancellation/failure/deadlines and a real bundled-artifact HTTP listener with disposable PGlite; inspect CLI invalid startup diagnostics.
5. Run focused tests, TypeScript, lint and scripts checks. Require independent exact-head formal review and required CI before merge. Installation remains separately gated on approved schema/session/target decisions.

Acceptance: actual default process serves built public artifact, dispatches workspace usage rather than old management-only listener, fails closed on missing principal audit, closes SQL once on signal, and emits no underlying errors. No native browser, installed PostgreSQL, login or live provider claim.
