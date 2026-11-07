# Credentials workspace integration (#637, #640)

1. Read #638–#643 and the original PRD. Reuse existing token APIs and frontend-owned credential components; do not import unrelated branch ancestry.
2. First run source and built-public host acceptance against the unchanged Models/Usage host: Credentials navigation must fail (RED).
3. Reuse the exact 62fd372 component snapshots (client, authority, workspace, app) and only the 15696c5 token-host composition delta. Preserve current Models/Usage integrations.
4. Verify exact-target issue/revoke confirmation, one-time secret removal, fresh IAM, mandatory audits, denial, expiry, stale controls and unknown-write latch across navigation/grant replacement. Add source/built real loopback HTTP, signed test SSO and migrated PGlite acceptance.
5. Run focused tests, typecheck, lint, scripts and compatibility checks; open a dependent PR and request exact-head independent formal review. No merge without all ancestor gates.
6. No new endpoint, permission, session, schema activation, deployment or paid provider call. This is not IdP login or installed deployment acceptance.

## Execution evidence

- Original RED: 0 pass / 8 fail, missing Credentials navigation; /tmp/og-1530-red.log.
- Reused component and source/built host suite: 144 pass / 0 fail / 0 skip; /tmp/og-1530-green.log.
- New source/built real mutation HTTP acceptance: 2 pass / 0 fail / 0 skip; /tmp/og-1530-http-corrected.log. Initial two failures were a test-only status label mismatch, corrected to existing Token revoked. copy.
- Typecheck passed; formatting only the new acceptance file changed. Public signed-out preview listens on http://127.0.0.1:18153/management with no database. Native browser unavailable: page tool and desktop observation both report Team Computer screen still being released. No native browser success claimed.
- Predecessor #760 a7119ea: all six CI SUCCESS, formal reviews absent; local serial whole test run 9247 pass / 1 worker SIGKILL fail / 1 skip. Do not call that local run a full pass.

- Final post-format focused acceptance: 183 pass / 0 fail / 0 skip, including existing SSO HTTP boundary and source/built host suites; /tmp/og-1530-final-focused.log. Typecheck PASS, lint PASS (42 pre-existing warnings, 265 infos, no errors); scripts/check.py PASS, all six pinned compatibility checks PASS, git diff --check PASS.
