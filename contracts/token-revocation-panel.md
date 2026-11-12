# Management token revocation panel (#640)

mountTokenRevocationPanel(root, request) uses a caller-owned authorized port. Call returned dispose() on identity/logout/expiry teardown. No authentication or credentials are discovered or persisted.

An opaque nonempty ID of at most 256 UTF-16 code units, without NUL or malformed Unicode, is sent only after a second explicit confirmation. POST /management/v1/proxy-tokens/revoke, JSON {credentialId}, no-store, redirect error. The existing server still freshly authenticates, authorizes, transacts and audits.

Only HTTP 200 application/json and exact {revoked: boolean} bounded to 4096 UTF-8 bytes establishes the result. True means revocation reported. False means no revocation reported, not proof of prior state. No raw response/exception text is rendered. 401/403 clear and terminally lock the mounted identity. Other failures are uncertain, never automatically retried or represented as rollback; another operation requires explicit input and confirmation. Abort/disposal suppresses late responses but cannot undo mutations.

Tests cover confirmation, exact request/no credential handling, ID validation, true/false, denial/failure, bounded malformed responses, overlap and teardown. Structural DOM/Fetch tests do not certify native browser, IdP, installed PostgreSQL or deployment. Reviewed session/navigation wiring remains frontend work.
