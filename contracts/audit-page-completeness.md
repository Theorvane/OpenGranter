# Complete audit metadata collections (#856)

Refs #637 and #642. The PostgreSQL audit reader and shared HTTP projector must validate every array position, including a lookahead row. Missing first, middle, last or all entries are invalid, not an empty or partially successful page. Never filter away malformed evidence. Public JSON/CSV reads fail503 with audit_history_unavailable and awaited read-unavailable metadata audit; if that audit fails, return audit_unavailable. Error bodies disclose neither event metadata nor underlying diagnostics.

Dense empty and valid collections retain existing audit:Read target checks, ordering, keyset continuations, filters and allowlisted metadata projection. Explicit Deny precedes storage. No credential/session, content retention, DDL or activation changes. This contract covers injected reader/SQL adapter boundaries; it does not claim a normal PostgreSQL driver produces sparse arrays or certify installed/browser/provider acceptance.

Regression: test/audit-page-completeness.test.ts plus existing audit reader, HTTP and CSV cases. New loopback tests exercise real HTTP with a controlled authenticator and injected reader; existing embedded SQL tests cover dense database pages.
