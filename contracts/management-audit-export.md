# Audit metadata page CSV projection

createAuditPageExportClient(request) exposes read(AuditFilters) and invalidate(). It is not authentication. The request port must already be authorized for the existing /v1/audit JSON API. The server retains audit:Read enforcement, explicit-principal scoping and mandatory read auditing.

- One read returns one validated metadata page projected to CSV using serializeAuditCsv. This is a local projection of format=json, NOT a server format=csv request. No whole-history export, traversal, credential acquisition, DOM or automatic download.
- ready contains csv, contentType (text/csv; charset=utf-8), hasMore and exact decimal nextCursor (string or null). Event IDs above the safe integer range are never converted to numbers. Empty pages contain only the CSV header.
- Caller filters are copied before await. The complete page must pass the underlying metadata client validation and the shared CSV projector. Retained prompt/response content and unknown fields never enter CSV. Invalid formula-like identifiers fail existing metadata validation; CSV encoding retains its existing formula defenses.
- invalid_query, unauthenticated, denied, unavailable and cancelled return no CSV or server body. Invalid input never triggers transport. Underlying 15-second deadline, 2 MiB JSON bound and response-integrity checks remain in force.
- Each read supersedes previous work. invalidate aborts and invalidates pending export completion. No output is cached. Host must invalidate AND remove existing rendered/download data on logout, expiry or identity change; completed caller-held strings cannot be revoked by this module.
- Browser download integration, approved session transport, installed PostgreSQL and real IdP/browser/provider E2E remain separate gates.
