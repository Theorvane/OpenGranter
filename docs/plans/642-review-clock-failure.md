# Review screen clock failure (#642)

1. Preserve the existing disconnected usage and audit screens and trusted grant contracts. No session, IAM, runtime or storage change.
2. Reproduce injected clock exceptions during initial authorization, timer expiry, current actions and pending read completion against both source and supported browser builds. Cover nonfinite and negative epoch values.
3. Treat an unreadable/invalid clock as expired: disconnect requests, erase protected DOM, revoke CSV URLs and suppress stale responses. Never display exception data or dispatch with indeterminate time.
4. Run focused source/artifact and existing integration tests, typecheck, lint and full checks. Submit dependent PR for independent formal approval and exact-head CI before merge.

Acceptance: initial invalid clock performs no request; live clock failure clears on the next deadline check without throwing; pending completion cannot repaint; revoked downloads cannot activate. This is local structural/build evidence, not authenticated native browser or installed SSO acceptance.

## Local evidence

- Final baseline RED: 24 failures / 4 passes with validated source/artifact fixtures; 28 cases before delay-sample and recovery strengthening.
- Final focused GREEN: 105 tests pass, zero failures/skips, including 32 new source/artifact cases, existing usage/audit screens, signed loopback integration and supported builds.
- Typecheck and planning/link/fixture secret checks pass. Full exact-head check and CI must be recorded separately.
- A local synthetic HTTP/browser smoke harness was prepared on port8822. Native browser navigation and desktop observation both returned screen-still-being-released errors; no native-browser outcome or SSO acceptance claimed.
