# Pin the installed management browser artifact

1. Preserve the existing separately built public UI and signed-access-token listener. Do not change session, IAM, deployment activation, or paid-call permissions.
2. Accept an optional exact lowercase 64-hex SHA-256 via trusted browserArtifactSha256 and OPENGRANTER_BROWSER_ARTIFACT_SHA256. Absence preserves legacy startup. Reject malformed configuration before DB ownership.
3. Hash the exact bounded file bytes while reading the existing single open descriptor, before UTF-8 publication and before migrations/listen. Reject mismatch using the existing fixed artifact error. A pin is integrity evidence only; it does not prove trusted provenance or approve deployment.
4. RED: a wrong pin currently starts the listener; invalid module/env pins are accepted. Add regression cases for empty, whitespace, uppercase, nonstring and wrong digest; never log file, path, expected or observed digest.
5. GREEN: matching multibyte public artifact runs through migrated PGlite and real loopback HTTP, serving exactly the pinned bytes; mismatch and malformed pins open no DB. Keep symlink release paths supported and legacy unpinned behavior unchanged.
6. Run focused tests, TypeScript, changed-file lint and repository script checks, then request independent exact-head formal review and all required CI before merging. Installed PostgreSQL, browser login, ingress and provider E2E remain unverified.
