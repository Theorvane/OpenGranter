# Audit browser artifact integration (#642)

1. Reproduce the supported browser builder rejecting audit client and app (two functional failures).
2. Extract unchanged metadata projection and history parsing into pure modules; preserve server reexports and error identity.
3. Add only exact canonical reviewed pure files to the shared allowlist. PostgreSQL modules, audit directories, external imports and symlink escapes remain forbidden.
4. Execute the supported browser artifact in the existing structural-DOM/real-HTTP/embedded-SQL screen regression. Verify metadata redaction, invalid pages, error identity and absence of SQL/runtime imports.
5. Run regression, typecheck, lint, exact-head CI and independent formal review before merge. No session, runtime, retention or provider activation.
