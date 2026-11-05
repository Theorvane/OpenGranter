# Usage principal query validation (#642)

1. Reproduce the mismatch: server accepts C1 controls in explicit principal filters although the browser rejects them. The RED signed direct HTTP test returns 200 and performs a usage read instead of invalid_request; reject consistently before policy/storage and preserve required audit.
2. Reject all Unicode Cc characters at the shared query parser, before policy evaluation or usage storage. Preserve valid Unicode IDs and explicit ReadAll semantics. No route activation, schema, session or permission change.
3. Add exhaustive C0/DEL/C1 parser coverage and a real HTTP/signed SSO/PGlite mandatory-audit regression. Keep invalid-query audit free of target metadata.
4. Run focused tests, typecheck, lint and full checks; request exact-head independent review and CI. Do not merge without approval.
