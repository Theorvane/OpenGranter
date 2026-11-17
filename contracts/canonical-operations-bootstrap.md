# Owned canonical operations integration

Opt in through `startPostgresSsoCanonicalOperationsBrowserGateway` in `src/gateway/postgres-sso-browser-bootstrap.ts`. It requires an absolute public JavaScript artifact path and reviewed lowercase SHA-256, plus trusted issuer/audience/JWKS/time/request-ID/connection/host/port inputs. Artifact validation occurs before database acquisition. The byte snapshot is immutable for the listener lifetime.

`startPostgresSsoCanonicalOperationsGateway` is the corresponding explicit runtime for an optional trusted in-memory public artifact. Neither factory is selected by existing read-only factories, CLI, environment defaults or installed services. Caller approval of this write-enabled selection is required before deployment. Cookie/BFF sessions, CORS and inference routes remain absent.

The shared owned lifecycle applies only existing numbered migrations, binds one socket and returns `{ address, close }`. Startup failure releases the acquired connection; repeated close is idempotent. Unknown endpoints remain private404. No configuration callback may override authentication, IAM, token issue/revoke or audit.

The caller still separately owns approval/installation of `contracts/sql/current-principal-audit.sql`; no new schema is installed for Account. Missing prerequisites fail closed. Existing fresh IAM, human bearer verification, token lifetime and audit-transaction gates remain unchanged.

Tests use real loopback HTTP with migrated PGlite and synthetic signed access tokens. They verify artifact mismatch before DB acquisition, artifact snapshot replacement, required Account DDL not installed, read/issue/revoke, repeated revoke, rejected proxy-token auth, fresh disabled identity/Deny, issue rollback on audit failure, failed startup cleanup, occupied-port cleanup and idempotent shutdown. These are not real IdP/browser-login/native PostgreSQL/installed-provider acceptance.

Rollback: select the prior read-only runtime. No existing runtime selection or deployment changed.
