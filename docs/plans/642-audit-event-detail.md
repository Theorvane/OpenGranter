# Inspect authorized audit event evidence (#637, #642)

1. Problem: the audit table exposes projected JSON but omits event ID, credential reference and evaluated policy versions. Operators cannot inspect that evidence in the mounted UI.
2. Add native, keyboard-accessible details/summary and labeled definition lists to each already-authorized row. Preserve table metadata and render values as text only. Show empty policy evidence explicitly without inventing a permission decision.
3. Reuse the existing browser client whole-page projection, fresh server IAM and mandatory audit. Do not fetch extra records or render raw server extras. Credential references are identifiers, never tokens. No retention, session, schema, runtime or deployment changes. Company SSO/BFF approval remains unresolved.
4. First write mounted-view tests expecting event/credential/policy evidence, redacted extras and no details after denial/expiry/clear, plus actual signed SSO + migrated PGlite + HTTP evidence. Capture expected RED before production edits; then implement a dedicated renderer and integrate it with the table.
5. Validate success, empty versions, safe text rendering, scoped failure and teardown. Native-browser checks are local synthetic integration only, not installed or company SSO acceptance. Run full npm check, exact-head CI and independent review; no merge without formal approval.
6. Contract: [audit event inspection](../../contracts/management-audit-event-detail.md). Rollback removes the view helper and table integration only. Existing public API and exports remain unchanged.
