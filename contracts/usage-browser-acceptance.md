# Usage screen local signed-SSO browser acceptance

`npm run management:usage:browser` requires Node >=22.14 and Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`). It is an explicit local acceptance command, not a default CI skip. It bundles the real usage app/client and exercises a real Chromium DOM against the concrete signed-SSO HTTP handler and disposable PGlite database.

The loopback fixture is TEST ONLY: an ephemeral token stays in server memory and is attached only to `/management/v1/usage` at the local server boundary. There is no token endpoint, cookie, token in HTML/JS/storage, production session bridge, installed runtime activation, real IdP, provider or paid request. The candidate usage audit schema is applied explicitly only to the disposable database. Never expose the fixture through ingress.

Required results: unknown usage/cost remains Unknown; filters/empty/page cursor work; CSV Blob contains the selected page; explicit-principal denial, revoked IAM and expired token remove records; audit-store failure produces unavailable without records; trusted clear removes records, filters and pending results. Metadata audit is asserted in SQL. Chromium failure fails the command. Clean shutdown closes its own browser through CDP, local listener, database and temporary profile.

Plan: [637](../docs/plans/637-usage-browser-acceptance.md). Script: `scripts/check-usage-browser.ts`. This evidence is local Chromium + signed fixture JWT + PGlite only, never installed PostgreSQL/company-SSO E2E or full PRD completion.
