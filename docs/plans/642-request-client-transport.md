# Exact request usage transport (#637 / #642)

1. Reuse #742 JSON request filtering on current runtime chain #855 → #859 → #880. Preserve old UI stack. Own only usage-client.ts and usage-export-client.ts; no DOM/session/runtime/SQL activation.
2. Before source edits, demonstrate RED for serialization, invalid IDs, mismatched JSON rows. Add actual HTTP JSON/CSV integration through signed JWT, migrations and PGlite.
3. Add optional requestId to both filter types. Validate exact case-sensitive ASCII 1..256 with the existing server grammar, serialize request_id without normalization, and retain it in JSON response-validation snapshot. Keep CSV verbatim; server remains authorization/filter authority.
4. Demonstrate GREEN including pagination, same-ID foreign-principal isolation, empty pages, Deny, durable access audit and existing regressions. Run full typecheck/lint and doc checks. Do not claim native browser, installed PostgreSQL, login or provider acceptance.
5. Publish against #880; require exact-head formal approval and all CI before merge. This extraction is not a new screen or authorization contract. It supplies request tracing to both browser transports, including CSV absent from #742.
