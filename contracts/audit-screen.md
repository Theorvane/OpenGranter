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
