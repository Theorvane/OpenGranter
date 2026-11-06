# Audit metadata screen (#642)

1. Reuse the existing /v1/audit JSON/CSV contract and its strict query and metadata projection; do not introduce an SSO audit endpoint or enable sessions.
2. Implement a disconnected request port client with bounded body, timeout, cancellation, validated descending event cursors and safe status messages. Server audit:Read and durable read auditing remain mandatory.
3. Implement a mountable screen with UTC/principal/model filters, paging, event detail, empty/loading/error states and explicit page-only CSV. Reuse trusted deadline and detached-control protections; retain no content or credentials.
4. RED/GREEN mounted-screen and real handler HTTP tests must verify isolation, projection, Deny, failed audit, export and stale authority. Test native browser separately; source-only ports are not deployed SSO.
5. Require exact-head CI and independent formal approval before merge. Session/IdP/CSRF/CORS/runtime activation remain HOLD.
