# Explicit same-origin administration browser composition

Refs #637 / #640; [plan](../docs/plans/637-administration-browser.md).

createPostgresSsoAdministrationBrowserHandler/Server is an explicit source-only alternative to the unchanged read-only review factories. The server is unbound. It serves the existing public static shell and caller-supplied public artifact plus existing registered-key SSO reads and credential mutations on one origin.

- Exact POST /management/v1/proxy-tokens and /management/v1/proxy-tokens/revoke dispatch unchanged to existing credential management. Fresh authentication precedes validation, current iam:Manage and owner caps remain enforced, and mandatory decision/lifecycle audit and atomic credential writes retain existing behavior.
- Other requests delegate unchanged to the read-only review handler: exact GET current principal, model list/encoded detail and scoped usage JSON/CSV. Unknown paths and methods are no-store/nosniff 404. No trailing-slash mutation aliases, credential inventory endpoint, inference route, method override or SPA fallback.
- Public static routes retain CSP, no-store, framing and method checks without SQL, authentication or Set-Cookie. A public artifact is not permission to read or mutate. Cookie-only requests cannot authorize a credential operation.
- The shared configuration is captured once. Child factories remain responsible for registered issuer/audience/keys, live bindings, IAM and concrete mandatory audit. Callers cannot inject a no-op audit or fake authentication port.
- The Node bridge uses fixed 503/internal_error with no-store/nosniff on adaptation failure; no private request/body/error projection.
- Existing read-only factories and all runtime defaults stay unchanged. This factory does not bind, open/close a database, migrate/promote schemas, select ingress, supply session/CSRF/CORS policy, inject/persist bearer tokens, acquire browser authority or call providers.

Caller must own reviewed SQL/schema lifecycle, public build provenance, explicit listen/TLS/ingress and any separately approved authority adapter. Existing candidate usage-audit schema needs its own review/promotion; composition is not installed activation. Existing mutation ambiguity/reconciliation and one-time secret constraints remain unchanged.

## Acceptance evidence

The management-administration-http-integration test runs source and built public workspace against actual same-origin loopback HTTP, signed test SSO and migrated PGlite without stubbed catalog/identity HTTP. Models/Account and confirmed issue/revoke retain fresh Deny and failed-audit rollback, no secret in audit and host-lifetime ambiguity latch. Boundary cases verify public SQL isolation, exact allowlist, unchanged read-only writes rejection, cookie rejection before malformed body validation, required anonymous audit failure and Node adaptation error.

These are local source/build/HTTP/database checks, not native-browser, company IdP, installed PostgreSQL, deployment or paid-provider acceptance.

## Explicit dedicated Account audit integration (#778)
An own principalAuditClient option on the existing review/browser and administration ports selects the reused #777 current-principal handler for exact GET /management/v1/me. Success remains {principalId}; its dedicated audit append is awaited on success/denial/failure. The option is captured once. An explicit undefined, null or invalid client fails construction rather than falling back. Absence (including inherited properties) preserves the legacy management identity behavior and default schemas. Static, catalog/usage and credential dispatch remain unchanged; /management/v1/principal is not added to the review allowlist. No callback audit override is exposed by these compositions.

Caller owns an explicitly reviewed/installed contracts/sql/current-principal-audit.sql table and committed/autocommit audit client; no default migration promotion, schema approval, exactly-once guarantee, session, authority acquisition, runtime activation or provider call follows. Existing credential writes retain fresh IAM and their original mandatory transaction/audit. Dependency identity/audit source is adopted from exact #77703b78979cbcef6bb59314570778e778900dd33b8; this integration requires its own new exact-head CI and independent formal review before adoption or merge.

## Render-owned Models controls (#637, #641)

The existing SSO Models view binds list, detail, refresh and error recovery controls to the exact snapshot that rendered them. Retained controls cannot consume a replacement grant, interrupt a later request, or generate extra API/audit activity. Activation synchronously checks expiry even when timers are suspended. Active controls still require fresh server authentication, IAM and mandatory audit; snapshot identity is not permission.

Source and compiled tests traverse signed test SSO, real loopback HTTP, migrated PGlite and durable catalog audit for list/detail/loading, current-policy404, empty, required-audit503/recovery and binding-removal401. This is not company SSO login, native browser, installed PostgreSQL or deployment evidence. See [plan](../docs/plans/637-model-controls.md).

## Same-operation Models recovery (#637, #639, #641)

Temporary unavailability in the existing Models screen exposes Retry separately from Back to models. Retry repeats the failed list or exact detail request, preserving mandatory fresh SSO/IAM/audit; a detail failure must not silently become a list read. Missing models and sign-in/denial states do not expose retry. Retry consumes only the render that created it and synchronously checks expiry, so double activation, detached controls and suspended expiry timers cannot dispatch extra reads. No retry is automatic. The failed target is in-memory only and replaced on authorization/list navigation; it is not authority or session state.

Source and compiled public module tests cover recovery, duplicate/stale controls and expiry. Signed-test SSO, loopback HTTP and migrated PGlite verify required-audit503 then same-detail200 with exactly one new durable audit event, plus list recovery, fresh Deny and binding-removal401. Native desktop observation remains500; an isolated headless Chromium attempt did not yield a debugging endpoint and a separate diagnostic timed out. Neither is browser acceptance. No installed PostgreSQL, company IdP, deployment or paid-provider acceptance is claimed. See [plan](../docs/plans/637-model-retry.md).


## Published model details (#637, #641)

The existing read-only model detail view now renders the already-decoded public name, description, context length, input/output modalities, supported parameters, provider context/output bounds and exact prompt/completion base-price strings in addition to ID/publisher/created. Shared proxy and explicit SSO mounts use the same presentation; only the SSO decoder retains reviewed provider bounds. No endpoint, projection or authority changes.

All values enter textContent; descriptions preserve line breaks without markup, links or resource loads. Omitted values read Not published, explicit null bounds read Unknown, empty description reads Empty, empty label lists read None published, and zero remains zero. Base prices retain their exact USD/token strings with no conversion, rounding, estimate or billing computation. Visible caveats identify metadata as non-authoritative for routing/effective limits and base prices as distinct from request costs. Existing navigation, loading, missing, denied and sign-in states still replace the entire detail subtree. No retention, credential input, browser authority acquisition or runtime activation.

Source and compiled public-mount cases cover legacy/empty/unknown/zero, inert markup and logout clearing. Signed-test-SSO loopback HTTP plus migrated PGlite cases cover persisted metadata to displayed details, fresh Deny, removed binding and metadata-free durable access audit. Structural DOM tests are not native-browser, company-SSO or installed-PostgreSQL acceptance.


## Concrete SQL audit opt-in (#637 / #642)

An own auditHistoryClient explicitly enables exact GET /management/v1/audit through the existing concrete SQL-backed audit handler. Omission retains 404 unless the legacy writeAuditHistoryAccess callback is supplied. Supplying both ports, even undefined, is a configuration error; invalid explicit SQL ports are rejected before any query. Inherited audit ports do not enable the route. No fallback to callback occurs if SQL fails.

The caller owns the separately reviewed access-audit schema and committed/autocommit SQL semantics. Fresh registered-key identity and current audit:Read authorization precede scoped metadata reads; awaited SQL access audit precedes JSON/CSV or failure responses. Missing-table/write failure withholds data. Public shell assets remain authority-free; no session, DDL promotion or installed runtime activation. See [plan](../docs/plans/637-administration-audit-sql.md).
