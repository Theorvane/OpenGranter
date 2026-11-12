# Browser audit history transport (#642)

1. Reuse the existing signed-SSO audit JSON query and event projection contracts for one authorized browser page. Add no session, authority, endpoint or runtime activation.
2. Add failing public-client tests for exact filter serialization, metadata redaction, bigint continuation, scope validation, safe failures and cancellation.
3. Implement an already-authorized request-port client with immutable request scope, bounded UTF-8 JSON, no-store reads and stale-result suppression. Reuse existing pure audit validators rather than invent event schemas.
4. Exercise the client through the actual signed-SSO Fetch handler with migrated PGlite and durable access audit; test denial and audit failure separately from browser acceptance.
5. Run focused regressions, TypeScript, formatting and repository check where available. Publish exact-head PR for independent review and CI. Native browser login, UI rendering, CSV and installed deployment remain separate work.


## Existing integration boundary

The current canonical browser builder accepts imports only within `src/management`.
Like the existing usage client, this transport reuses pure shared validators outside
that directory. Its direct canonical build is therefore rejected today. Do not
relax that source boundary or duplicate the audit event schema in this slice.
The frontend owner must review a narrow shared-module build integration before
including this client in a published artifact. No rendered or installed UI claim
is made by the transport tests.

## Verification and recovery

- Focused baseline with an exported unavailable-only port must fail the positive
  serialization and pagination assertions (not merely module resolution).
- Exercise migrated embedded SQL through signed-SSO Fetch, exact bigint cursor,
  empty/filter cases, foreign-principal denial before history SQL, invalid token,
  and mandatory durable access-audit failure.
- Test malformed/redacted metadata, immutable filters and one-time accessors,
  bounded UTF-8, byte lengths, timeout, supersession and stuck-body cancellation.
- Revert this additive module to recover; no migration, session or listener is
  activated. Original PRD, native browser, actual IdP, installed PostgreSQL,
  content-retention decisions and paid-provider acceptance remain open.
