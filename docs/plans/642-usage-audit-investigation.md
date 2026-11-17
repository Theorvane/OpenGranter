# Usage request audit investigation (#642)

1. Add the missing Usage-to-Audit investigation beside the existing reverse link. Use the exact validated request ID and only the destination Audit applied filters, never source Usage identity/model/time or unsubmitted drafts. Reset pagination with a fresh load.
2. RED: new DOM and real signed-bearer loopback/PGlite cases must fail for the missing action. GREEN: verify successful scoped audit retrieval, fresh Deny, mandatory audit persistence failure, invalid destination scope, disposal and stale control suppression.
3. Keep server authentication, audit:Read, principal scoping, durable access audit, CSV pagination and shared terminal-denial semantics unchanged. No new authority/session/runtime, content retention, schema or paid calls.
4. Run regression/type/lint/document checks, publish exact-head PR and request independent review. Merge only with full required CI and formal approval. Browser/native PostgreSQL/company IdP/installed acceptance remains separate.
