# Explicit SSO workspace runtime (#637 / #639)

`startPostgresSsoWorkspaceGateway` is a separately selected source integration on the consolidated workspace branch. It connects the existing public shell, fresh SSO Account, scoped models/usage and separately authorized credential mutation handlers to the established owned connection/listener/shutdown boundary. It is not selected by any existing CLI, bootstrap or default runtime.

- The trusted caller supplies a nonempty public JavaScript artifact and existing issuer/audience/public JWKS configuration. The artifact is not identity or permission. No cookie/BFF/session authority, token bridge, policy grant or provider call is introduced.
- One owned connection supplies identity, IAM, and mandatory audit SQL. Its query acknowledgement must mean committed/autocommit SQL; do not pass an uncommitted transaction. Identity reads remain non-serializable with revocation.
- Only the existing default migration manifest runs. The candidate current-principal and SSO usage audit schemas remain excluded. This source integration does not approve, provision or migrate either table. Installed activation requires the respective schema owner/security decision and explicit installation. Absent/broken identity or usage audit tables suppress the private result with `503 audit_unavailable`.
- Account returns only the established principal projection. Models and usage retain their existing fresh identity/policy/audit checks; identity success grants no `usage:ReadSelf` or `iam:Manage`. Credential writes retain the existing dedicated POST path checks and mandatory audit.
- Connection/listener cleanup and idempotent close reuse the private owned runtime core. Existing `startPostgresSsoManagementGateway`, public bootstrap and service CLI behavior are unchanged.

## Evidence and promotion gates

The disposable PGlite loopback test installs candidate DDL only inside that test database after asserting startup did not create it. It proves real Node HTTP dispatch, committed embedded-database audit, empty model/usage results, IAM denial, missing-audit failure, fresh binding revocation and resource ownership. It does not prove native browser rendering, company IdP login, session/CSRF, installed PostgreSQL durability, approved DDL, live inference or deployment.

This change stacks on #796 and its inherited backend source dependencies. Independent exact-head formal approval, all required CI, source-boundary review, and the separate session/schema/installed-target decisions remain gates. No ancestor approval transfers to this change. Existing localhost listeners are not replaced or promoted by its tests.
