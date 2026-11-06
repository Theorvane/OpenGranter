# Usage cleanup cancellation isolation (#642)

1. Reproduce the existing usage screen defect: a throwing expiry cancellation interrupts logout/denial/disposal before transport, records and CSV URLs are cleared.
2. Add regressions for source and supported browser artifact across unauthenticated, expired, denied and dispose. Verify protected metadata/link removal, actual blob revocation, stale-control no-dispatch and one cancellation.
3. Detach cancellation before invoking it, contain its private exception, and always continue mandatory cleanup without changing session or IAM contracts.
4. Run focused usage/workspace/build checks and mandatory checks, keeping source/structural DOM, native browser, installed PostgreSQL and provider evidence separate.
5. Publish a dependent PR; require exact-head CI and independent formal approval plus parent gates before merge. No session activation, deployment or paid calls.

## Local evidence

- Initial CSV fixture used audit pagination header; corrected before claiming meaningful RED.
- RED at unchanged implementation: all 8 source/artifact lifecycle cases failed on PRIVATE_CANCELLATION_ERROR. Log /tmp/og-2100-usage-red.log.
- GREEN: 8/8 source/artifact lifecycle regressions pass, no skips; /tmp/og-2100-usage-green.log.
- Focused usage, integration, workspace and browser build: 71/71 pass, no skips; /tmp/og-2100-usage-focused.log. Typecheck passed; formatter reports informational suggestions only.
- Full mandatory check is run separately and must be verified before any success claim.
