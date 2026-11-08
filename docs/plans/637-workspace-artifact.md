# Workspace public artifact bootstrap (#637 / #639)

1. Add an explicit trusted-file entry point to the opt-in workspace runtime. Reuse the bounded strict UTF-8 reader; reject invalid files before opening SQL.
2. Preserve existing browser bootstrap, operator service, default runtime, auth, audit, migration manifest and UI files. No session or installed activation.
3. RED: new workspace bootstrap export absent. GREEN: build actual SSO workspace artifact and serve real loopback HTTP with disposable PGlite; /me fails503 without candidate audit schema, models401, no credential grants; invalid artifact variants open no connection.
4. Run focused regression, typecheck, lint and scripts check; request exact-head review and CI. Do not merge or install without gates.
