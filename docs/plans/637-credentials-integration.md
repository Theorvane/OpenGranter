# Credentials workspace integration (#637, #640)

1. Read #638–#643 and the original PRD. Reuse existing token APIs and frontend-owned credential components; do not import unrelated branch ancestry.
2. First run source and built-public host acceptance against the unchanged Models/Usage host: Credentials navigation must fail (RED).
3. Reuse the exact 62fd372 component snapshots (client, authority, workspace, app) and only the 15696c5 token-host composition delta. Preserve current Models/Usage integrations.
4. Verify exact-target issue/revoke confirmation, one-time secret removal, fresh IAM, mandatory audits, denial, expiry, stale controls and unknown-write latch across navigation/grant replacement. Add source/built real loopback HTTP, signed test SSO and migrated PGlite acceptance.
5. Run focused tests, typecheck, lint, scripts and compatibility checks; open a dependent PR and request exact-head independent formal review. No merge without all ancestor gates.
6. No new endpoint, permission, session, schema activation, deployment or paid provider call. This is not IdP login or installed deployment acceptance.
