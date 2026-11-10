# Management usage CSV export transport

createSsoUsageExportClient accepts an already-authorized request port and exposes read(filters) and invalidate(). The fixed GET /management/v1/usage path always includes format=csv; filters are optional principalId, model, fromMs inclusive, toMs exclusive, limit 1..100 and opaque cursor. Server usage:ReadSelf/ReadAll authorization is unchanged. No principal is inferred or inserted for self reads.

Ready returns verbatim CSV, hasMore and nextCursor after checking text/csv, x-has-more and consistent consumable continuation headers. CSV formula mitigation belongs to the existing server serializer; the transport neither reparses nor reprices exported rows. It never concatenates pages or declares the first page a complete export. Preserve the same filters with the returned cursor. Maximum page size is 2MiB UTF-8 bytes with a 15-second deadline.

Responses map 400 to invalid_query, 401 to unauthenticated, 403 to denied and other statuses/transport/encoding/metadata failures to unavailable without exposing error bodies. Requests are no-store, redirect:error, Accept:text/csv. New reads and invalidate abort and suppress old results even when transport ignores AbortSignal. UI MUST invalidate on identity/session change, discard prior data and supply fresh authorization itself. Error/unread bodies are cancelled without awaiting untrusted stream cancellation.

No credentials, persistent storage, DOM/download, listener, session/BFF activation, provider invocation or database changes. This transport alone is not a browser screen or installed acceptance. Local signed-JWT/PGlite/Fetch integration uses an in-memory metadata audit sink, not the durable factory from PR842.

Plan: [implementation](../docs/plans/642-browser-usage-export.md). Test: test/management-usage-export-client.test.ts. Parent #637 / #642.


## Verbatim CSV encoding (#642)

Preserve an existing leading UTF-8 byte-order mark, including when it is split across stream chunks; never add a marker to an unmarked export. Strict UTF-8 decoding and existing byte/time bounds remain enforced. This transport-only correction does not activate UI/session/downloads. See [plan](../docs/plans/642-csv-byte-order-mark.md).
