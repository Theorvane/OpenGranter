# Audit public browser integration (#637/#642)

1. Reproduce the actual audit client/workspace build rejection through the restricted public builder.
2. Extract the unchanged content-free gateway event projector from SQL storage; preserve server exports and error identity.
3. Allow only individually reviewed pure audit query/filter/projector modules, never SQL, directories, or server entry points.
4. Build and execute the real client/workspace bundles; verify metadata redaction, principal isolation, invalid filters, authority clearing and negative SQL-boundary cases. Run server audit regressions and type/lint checks.
5. Publish an exact-head PR for independent review and required CI. No merge before both gates; no session, DDL, deployed UI or live-provider claims.
