# Required common gateway SQL audit acknowledgement

The existing INSERT must resolve to an object with own rows: an array containing exactly one own non-array object row with own event_id. The identity must be a positive safe integer number or canonical positive decimal string not exceeding 9223372036854775807. Sparse/inherited fields, missing/null/boolean/fractional/unsafe/negative/zero/out-of-range identities are unavailable, never success.

Valid pg string and PGlite integer representations remain supported. Invalid result, getters throwing or query rejection expose only GatewayAuditUnavailable. Authentication-denial audit through existing management and administration HTTP must complete before 401; malformed acknowledgement returns 503 audit_unavailable with no-store and no credential operation. No automatic retry.

Existing parameterized INSERT, event projection, DDL and activation defaults are unchanged. Caller owns committed/autocommit SQL; acknowledgement is not independent proof of commit or exactly-once persistence.
