# Workspace audit history route

The existing explicit `startPostgresSsoWorkspaceGateway` and administration browser composition accept an optional **own** `writeAuditHistoryAccess(event)` port. This is a trusted async SSO access-audit writer, not a policy grant or gateway proxy event writer. See [SSO history](sso-audit-history.md) for the event and HTTP contract.

- Without the property, `/management/v1/audit` retains its previous 404. Explicit undefined, null or other non-function values fail configuration; owned runtime validation precedes SQL acquisition.
- With a function, exact GET `/management/v1/audit` dispatches the existing registered-key SSO/fresh IAM service using the same owned database connection for identity and gateway-history reads. Self/explicit target both require `audit:Read`; Deny wins. No cookies, CORS/session authority or token translation is added.
- Existing service awaits the writer for successful JSON/CSV, invalid queries, denied/anonymous requests and SQL failures before releasing private results. Failure returns 503 audit_unavailable. The trusted caller must ensure the Promise resolves only after durable commit; runtime does not infer durability from a function shape.
- Wrong methods/paths retain 404 and do not dispatch audit service. Shell/assets and Account/models/usage/credentials keep their prior contracts. Static assets confer no identity or policy rights.
- No DDL, new migration, startup wrapper, default runtime activation, UI source edit or provider call. This programmatic opt-in does NOT approve a writer/store/schema. Do not enable it in deployment until its durable implementation is reviewed and approved. The existing artifact bootstrap/service configuration is unchanged.

## Evidence boundary

Real loopback Node HTTP -> fresh signed JWT -> disposable PGlite gateway SQL validates dispatch, pages/filters/empty results/CSV, isolation, IAM changes/revocation, SQL failure, writer await/failure, configuration validation and owned cleanup. The test writer is an in-memory sink: no installed durability, company IdP/session or native browser acceptance is claimed. No persistent test URL remains after cleanup. Promotion requires exact-head CI and valid independent formal approval, separately from installed activation approvals.
