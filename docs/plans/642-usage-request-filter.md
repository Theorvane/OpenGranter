# Exact usage request tracing (#642)

1. Add an optional exact request_id intersecting existing principal/model/UTC/keyset scope. It groups existing attempt evidence, not settled billing or global request identity.
2. Before production, exercise RED parser, parameterized SQL isolation/lookahead, existing HTTP/CSV boundaries and source/artifact screen trace controls.
3. Carry the filter through proxy and SSO readers, JSON/CSV and browser validation. Preserve fresh IAM and mandatory audit; no DDL, session, runtime or provider activation.
4. Expose an editable Request ID filter and explicit per-attempt trace action. Retain submitted bounds, reset cursor/history/drafts and CSV.
5. Run focused tests and persisted SQL regressions, typecheck/lint/planning/compatibility. Publish exact HEAD PR for independent review and all required CI; no merge without formal approval and ancestor gates.
