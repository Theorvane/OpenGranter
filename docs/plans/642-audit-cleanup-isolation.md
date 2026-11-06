# Audit cleanup cancellation isolation (#642)

1. Reproduce reviewer finding at base 9b7f9a4: throwing expiry cancellation interrupts logout, retaining protected metadata and CSV URLs.
2. Add source and supported-browser-artifact regressions for clear, denied, expired and dispose. Check data/link removal, URL revocation, stale controls and exactly one cancellation.
3. Detach the cancellation handle and contain its exception so mandatory invalidation, data, DOM and URL cleanup continues without private errors.
4. Run focused and mandatory checks; keep RED/GREEN evidence separate from native-browser and installed E2E.
5. Publish a dependent PR with exact-head CI and independent formal approval gates. No session activation, permission changes, deployment or paid calls.

## Local evidence

- Corrected initial test setup label before claiming RED. Meaningful RED: 8/8 regressions fail with PRIVATE_CANCELLATION_ERROR at unchanged clear. Log /tmp/og-2030-audit-red.log.
- GREEN: 8/8 source/artifact regressions pass, no skips. Log /tmp/og-2030-audit-green.log.
- Focused audit screen/build/host/workspace tests: 29/29 pass, no skips. Log /tmp/og-2030-audit-focused.log.
- Full mandatory check started separately; result must be verified before claiming success. Structural DOM and local HTTP evidence are not native-browser login or installed acceptance.
