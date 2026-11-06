# Source-only audit metadata screen (#642)

## Boundary

`mountManagementAudit` is disconnected by default. The host may supply a trusted `CatalogRequest` through `authorize({request, expiresAt})`, or through low-level `connect(request)` with an externally owned expiry/clear lifecycle. Neither method authenticates, grants audit permissions, obtains/stores a token, nor mounts any route. The host must clear on logout, identity or permission change and dispose on unmount. This module is intentionally NOT added to the SSO workspace or runtime: no reviewed SSO audit adapter/session contract is assumed. Do not forward a browser bearer to an unrelated origin. The existing `/v1/audit` handler still performs fresh `audit:Read` authorization on the target principal, required read auditing and server projection. Default self scope is resolved only on the server.

## Reads and rendering

The client GETs `/v1/audit` with `format=json` or `format=csv`, no-store, redirect error and credentials omit. A trusted port may independently supply approved authority, but must preserve the API boundary. Optional principal/model/from_ms/to_ms/limit/cursor filters use the existing parser. Exact Unicode principal references are not normalized by the client. The form trims submitted outer whitespace consistently with usage controls. UTC form values use the existing strict conversion, with exclusive end. Rejected drafts remain editable; Clear filters starts a fresh self-scoped first page.

JSON response pages are bounded to 1 MiB and the requested limit (default50, max100). Descending positive decimal bigint event IDs/cursors are validated, without inventing or incrementing cursors. `has_more` must match a non-null cursor equal to the last returned ID. The existing allowlisted audit projector reprojects every event, validates range/model/order and single-principal consistency, discarding unknown/private fields. For self queries the first event principal is a response consistency check, never identity or permission. Empty pages require no continuation. The first-party server remains the authority for actual self identity and IAM.

The screen renders event ID, UTC time, kind, principal, request ID and expandable credential/policy-version/allowlisted details using text nodes only. No content audit retention, prompts, responses, secret values or billing is enabled. Loading, empty, validation, denied, unauthenticated, unavailable and cancellation states are explicit. Responses/errors are not placed into HTML or raw error messages.

## Authority and exports

Trusted deadline checks, timer cancellation, generation checks and detached-control guards prevent old reads/actions from consuming new authority. Pending reads abort and settle on clear, renewal, cancellation or disposal, even with an uncooperative request port. A 30-second deadline bounds each read. Previous/Next reuse exact filters and returned cursor; Refresh does not silently reset the page. No all-pages fetch is automatic.

CSV is the existing server-projected page export and uses `x-has-more` / `x-next-cursor`. The client validates paging metadata and decreasing cursor progression. A download object URL is revoked on new read/export, reset, clear, renewal, denial, expiry and disposal. Activation checks guard suspended timers and detached links. CSV continuation is explicit and preserves export filters. There is no client-side secret-redaction claim for an untrusted CSV server: the supplied port must enforce the existing server projection.

## Evidence and exclusions

`test/management-audit-screen.test.ts` executes both source and an actual browser-target bundled module against the existing real loopback HTTP handler and embedded PostgreSQL-compatible SQL reader/writer, with isolated migrations, seeded other-principal data, acknowledged read audit, Deny, audit failure and CSV. DOM is structural, NOT a native browser. These tests use test-only authority and do not establish IdP login, installed PostgreSQL, TLS/ingress, runtime activation or live-provider acceptance. No schema migration or production deployment is performed.


## Supported audit browser artifact (#642)

Audit client and screen must build through the supported management browser builder, not unrestricted esbuild. Shared pure projection/query validation preserves the server contract and error identity. Exact canonical dependency allowlisting excludes SQL adapters and runtime modules. Structural-DOM execution of that artifact is not native-browser or installed acceptance. See [plan](../docs/plans/642-audit-browser-build.md).

## Current-page request correlation (#642)

The ready nonempty audit page also provides native expandable request traces. Groups use exact principal plus request ID (not request ID alone), first-seen group order and unchanged server event order. All events, including repeated entries and bigint event IDs, remain visible. Counts refer only to this page; they are not full request history, billing, causality, inferred execution order or success. Each event shows UTC time, kind and the same text-only projected credential/policy/details used in the table. Expansion makes no request. No automatic history fetch, client deduplication, cross-page cache or authority is introduced. Trace nodes are owned by the current ready page and removed with it on all existing lifecycle transitions. This does not authorize SSO workspace integration. See [plan](../docs/plans/642-audit-request-trace.md).

## Timer cancellation failure isolation (#642)

Expiry cancellation is best-effort, not a prerequisite for security cleanup. Clear for logout/denial/expiry and disposal detach the cancellation handle once and suppress its private exception while completing request invalidation, protected metadata/filter removal, DOM clearing and CSV object-URL revocation. Generation invalidation continues to reject stale timer callbacks and controls. This changes no session or deployment boundary. Source and supported-artifact regressions cover all four cleanup entry points. See [plan](../docs/plans/642-audit-cleanup-isolation.md).

## Indeterminate trusted clock (#642)

A trusted clock that throws, returns a negative epoch or a nonfinite value cannot prove the grant is still valid. Initial authorization performs no request; subsequent deadline checks (actions, timers, download activation and read completion) clear protected rows, filters, transport and CSV links as expired without displaying the exception. The timer delay calculation also checks its second clock sample before scheduling. Low-level connect retains externally owned clearing; this does not supply a session or change server authorization. See [plan](../docs/plans/642-review-clock-failure.md).
