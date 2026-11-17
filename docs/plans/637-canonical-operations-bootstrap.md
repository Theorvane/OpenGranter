# Canonical operations owned bootstrap (#637, #640)

1. Preserve read-only runtime, CLI, authentication, IAM and session contracts. Add a separately selected operations runtime and artifact bootstrap only.
2. Reuse existing owned migration/listener/shutdown lifecycle, enumerating trusted server inputs. Never install separately managed Account audit DDL.
3. Verify required public artifact SHA-256 before opening any database. Snapshot artifact bytes at startup.
4. RED: route a provisional operations bootstrap through the existing read-only runtime; prove authenticated issue returns 404 instead of 201 over a real loopback socket.
5. GREEN: select the operations composition; test issue/revoke, Account prerequisites, revocation/Deny, audit rollback, no proxy inference, artifact rejection before open, cleanup and idempotent close.
6. Run focused tests, typecheck/lint/scripts checks and open draft PR on #955; require exact-head CI and independent formal approval before ordered merge. No deployment, real IdP, cookie session or paid-call certification.
