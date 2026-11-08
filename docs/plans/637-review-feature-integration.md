# #637 Review feature integration

1. Compare #722 ancestry with source-only #716–#721. Reuse their existing plans/contracts and implementations; combine documentation append conflicts without removing either contract.
2. Integrate existing render-lifetime protection, expiry-safe CSV, page cost coverage, model-to-usage drilldown, filter correction and exact Unicode audit references into the same unbound browser/API composition. No session, schema promotion, installed runtime or paid calls.
3. Execute the actual built workspace served by the source-only server against signed test SSO, embedded SQL and durable audit. Assert summary, stale-control isolation, drilldown, export revocation and fresh IAM denial together. Test authority is explicitly injected, not native-browser acceptance.
4. Prove RED on #722 without integrated features, then GREEN on combined source. Run focused tests plus required checks; request independent exact-head review. No merge until all exact-head CI and formal approval.
5. Native-browser IdP acquisition and installed/live provider acceptance remain blocked on separate approved contracts and environments.

## Local evidence

- Baseline 8972f53 with only the new integration assertions: 0 pass / 1 fail / 0 skipped at the missing page summary (product integration RED).
- Combined source: 172 focused tests pass / 0 fail / 0 skipped, including the built workspace plus signed HTTP/embedded SQL composition; typecheck, lint, documentation/contracts checks and pinned compatibility checks pass.
- Initial x64 Node attempt failed on this arm64 host before tests; corrected to existing arm64 Node 22.23.4. This environment failure is not product RED.
- Full standard check is started separately; final CI and independent exact-head review are required before merging. No live IdP or native-browser acceptance claimed.
