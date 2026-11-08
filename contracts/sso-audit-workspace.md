# SSO audit workspace

Read-only explicit trusted composition; not a browser login or an IAM grant. The host obtains a CatalogAuthorityGrant plus trusted principalId from its approved session adapter. Server authentication and fresh IAM remain mandatory for every read. Host calls clear on principal/policy change and dispose on unmount.

Snapshot state contains only one page and at most one explicit CSV page (never automatic export traversal). Each load clears old page/export immediately. Next uses the server decimal cursor; previous replays captured query values. CSV requests the displayed page query independently and is not an immutable database snapshot. Changing data can change rows; do not label it a complete export. No DOM, URLs, cookies, storage, listener, schema or production activation is introduced.

## Host integration

Create with createManagementSsoAuditWorkspace({ onChange, now, schedule }). Pass authorize({ request, expiresAt, principalId }) only from the approved trusted adapter; then load(filters), next(), previous() and exportCsv(). Render snapshot() using text-only fields. clear() revokes local state; it does not log out the server. dispose() permanently revokes this instance. Permission changes must clear or renew the entire grant. A principal filter never grants cross-principal access: server IAM still decides.

States distinguish idle/loading/ready/empty/exporting, invalid query/unavailable/cancelled and unauthenticated/expired/denied/disposed. One page is held at a time. Snapshots are defensive copies and validate expiry even if browser timers are paused. Filter changes cancel the prior list/export and discard prior page/export immediately. Export failure discards the page; submit the filters again to retry. No exported object URL is retained by this controller; UI owns download URL revocation on every lifecycle change.
