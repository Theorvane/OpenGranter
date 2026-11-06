# Usage to scoped audit navigation (#642)

1. Reuse existing disconnected usage/audit screens. Add optional usage-row navigation to audit for its exact principal/request pair, preserving submitted model/UTC/page-size bounds only. No completeness, causal outcome or billing claim.
2. Before production code, write source and supported-bundle RED cases for scope, CSV, reset, denials and stale authority. Audit initial hints must be snapshotted and cursorless; invalid hints fail locally.
3. Implement guarded callbacks, initial audit filters and trusted workspace composition. Dispose the previous view and its exports. Never retry a denial with broader scope; usage visibility is not audit permission.
4. Keep authentication, session, API, schema and installed runtime unchanged. Important integration gate: audit-client targets proxy-authenticated /v1/audit, while the SSO workspace server does not mount it. A future approved adapter must independently provide the correct audit authority; a shared source port is not evidence of valid installed SSO.
5. Run focused regressions, typecheck, lint, planning and compatibility checks. Publish an exact-head PR; no merge before all ancestor/head required CI and valid formal approval. Browser, installed SSO and live-provider acceptance remain separate gates.
