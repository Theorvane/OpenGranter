# Required common gateway SQL audit acknowledgement

The existing INSERT must resolve to an object with own rows: an array containing exactly one own non-array object row with own event_id. The identity must be a positive safe integer number or canonical positive decimal string not exceeding 9223372036854775807. Sparse/inherited fields, missing/null/boolean/fractional/unsafe/negative/zero/out-of-range identities are unavailable, never success.

Valid pg string and PGlite integer representations remain supported. Invalid result, throwing getters and query rejection expose only GatewayAuditUnavailable. Existing management credential authentication denial awaits this acknowledgement before401; malformed acknowledgement returns no-store503 audit_unavailable without credential operations. Both chat bases fail closed with their existing private error formats before route, limit or upstream work. No automatic retry.

Existing parameterized INSERT, shared event projection, DDL and activation defaults are unchanged. Caller owns committed/autocommit SQL; acknowledgement is not independent proof of commit or exactly-once persistence.
