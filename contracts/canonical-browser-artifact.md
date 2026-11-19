# Canonical browser artifact bootstrap

`startPostgresSsoCanonicalReviewBrowserGateway` requires trusted absolute `browserArtifactPath` and `browserArtifactSha256` (64 lowercase hex characters). It validates and snapshots the bounded UTF-8 artifact before database ownership, then starts the explicit owned canonical read-only listener. The verified file is the only shell source; extra JavaScript or reader/audit overrides have no authority. File replacement after startup cannot replace served bytes.

Only canonical model list/detail, usage and audit JSON/CSV APIs are mounted. Every protected request retains current signed-SSO/IAM and mandatory durable audit. Public HTML/JavaScript grants no authentication; cookies remain insufficient. No inference or token mutation route is mounted.

Legacy token bootstrap retains optional pins and unchanged behavior. New bootstrap never activates itself or changes an existing service launcher, session, CSRF/CORS, policy, migration, provider or deployment configuration. Missing/malformed/mismatching pins and invalid files use fixed artifact-unavailable diagnostics before SQL; later owned-runtime failures preserve existing cleanup and fixed errors. Callers own reviewed bundle provenance, ingress/TLS and operational approvals.
