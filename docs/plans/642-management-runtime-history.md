# Management runtime history integration (#642)

## Issue and problem

Issue #642, parent #637. The explicit SSO browser process starts the owned management listener, but that listener dispatches only catalog and token routes. Reviewed canonical usage/audit readers exist on a separate read-only listener; selecting the existing browser process still returns 404 for those APIs.

## Scope and expected behavior

Compose existing durable usage and audit handlers on the existing opt-in management listener, sharing its migrated connection, trust configuration, clock and request IDs. Match only exact history paths. Preserve token/catalog behavior, unknown path rejection, public-shell opt-in, fresh binding/IAM checks and awaited durable access audits. No new permissions, query contracts, SQL schema, session, cookie, IdP, provider calls or default process activation. The separate read-only canonical listener must remain read-only.

## Design

Enumerate trusted history inputs rather than forwarding arbitrary extra callback properties. Instantiate the existing factories and dispatch exact /management/v1/usage and /management/v1/audit before existing model/token dispatch. Reusing these factories preserves JSON/CSV, filters, redaction and mandatory audit. A second deployment listener is already available but does not repair the selected management-process integration. Session acquisition and approved real deployment remain independent owner gates.

Contracts: [runtime](../../contracts/sso-management-runtime.md), [usage](../../contracts/sso-usage-history.md), [audit](../../contracts/sso-audit-history.md). Existing [PRD](../PRD.md), [architecture](../architecture.md) and [acceptance](../acceptance.md) remain authoritative.

## TDD plan

First run public owned-runtime tests against unchanged production code: signed JWT, migrated embedded PostgreSQL, real loopback HTTP usage/audit success must fail with current 404. Then minimally compose handlers. Cover JSON/CSV, anonymous/cookie/proxy-token denial, fresh Deny and removed binding, mandatory audit failure, unknown/prefix paths, existing catalog/token routes, shell selection and owned close. No fabricated billed data. Full typecheck/lint, planning checks, compatibility pins and npm run check follow.

## Delivery

Publish issue-numbered branch and PR with exact RED/GREEN evidence; require all exact-head CI and independent formal approval before merge. Rollback removes history dispatch from this opt-in runtime; stored records and separate read-only runtime remain unchanged. Local signed JWT/PGlite/HTTP evidence is not company IdP, native-browser login, installed PostgreSQL, provider or paid acceptance.

## Local delivery evidence (2026-11-13 Asia/Seoul)

- RED against unchanged runtime: five meaningful failures, zero passes/skips; four HTTP 404 instead of 200 and one required-audit gate never entered. Log: /tmp/og-0500-red.log.
- GREEN: focused five passed, zero skips; /tmp/og-0500-green.log. An initial test expected wrong-method 404; inspected the existing history contracts/handlers and corrected that assertion to their established 400 without changing production semantics.
- Eight-file regression attempt: 47 passed, two test-file SIGKILL resource failures, zero skips; /tmp/og-0500-regression.log. Corrected resource configuration for those two files with --max-old-space-size=128: all nine passed, zero skips; /tmp/og-0500-resource-correction.log. Do not describe the first attempt as green.
- Full TypeScript passed. Full Biome: 628 files, zero errors, inherited 42 warnings/175 infos. Planning/link/contracts/fixture scan, six offline schema pins and git diff --check passed.
- npm run check could not start: managed bin/npm is a pre-existing zero-byte nonexecutable file. One corrected direct npm-cli invocation failed on missing walk-up-path. No toolchain repair or aggregate full-check success claimed. Exact-head CI remains required.
- Tests use signed in-memory JWTs, real loopback HTTP and migrated PGlite. This is not real company SSO, native-browser rendering, installed PostgreSQL, deployment or provider acceptance.
