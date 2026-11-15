# Operations catalog integration (#637, #641)

1. Confirm the original model-catalog requirement and reuse existing SSO list/detail transport, session and DOM renderer. The trusted operations caller owns authentication, expiry and teardown; never synthesize a grant.
2. Add failing navigation tests for Models, list/detail/back, loading/empty/error, denial, navigation cancellation and stale retained actions. Preserve history/token behavior.
3. Mount a disposable SSO catalog workspace through the existing guarded operations request. Screen switches clear data, abort reads and fence callbacks. No public-entry, session, IAM, routing, pricing or mutation changes.
4. Run RED/GREEN, focused management regressions, typecheck, lint, contract checks and browser build. Exercise owned HTTP separately if available; distinguish synthetic from installed/provider evidence.
5. Submit an exact-head PR for independent review and required CI. Do not merge without both formal approval and required checks; deployment remains separately gated.
