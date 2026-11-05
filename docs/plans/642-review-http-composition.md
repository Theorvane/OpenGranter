# Scoped review HTTP composition (#642)

1. Preserve the existing catalog and usage read/export contracts; construct one explicit server-only Request handler from trusted shared SQL and registered-key configuration. Do not compose credential writes.
2. Dispatch only exact usage or catalog paths. Unknown paths and writes fail closed without SQL access. Keep original Request, signal, query, headers and mandatory per-operation durable audit; never cache authentication or fall through between handlers.
3. Add failing tests for the missing factory, replace workspace test-only routing with production composition, then verify signed SSO + loopback HTTP + SQL + audit, CSV, detail, unauthenticated, fresh IAM denial and audit failure.
4. Run focused tests, typecheck, lint, planning and full checks. Publish an independently reviewed exact-head PR; no merge without all required CI and approval.
5. This source-only opt-in composition does not edit runtime, entry, session, manifest, schema or listener activation. Candidate usage audit DDL remains test-only pending reviewed promotion. Installed/browser/provider acceptance remains separate.
