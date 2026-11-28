# History action keyboard focus

Issue #1004; refs #637/#642. Same-tab asynchronous renders and local discard replace focused buttons. Preserve focus on the same enabled action only, using render-local button identity and its existing label. Do not choose another action, cross tabs, steal external focus, or restore private controls on denial/disposal. Input caret restoration remains unchanged. No new domain terms or unresolved authority decisions; existing UI accessibility and private-data lifetime requirements apply.

Own history-app.ts, history-action-focus.test.ts and this plan/contract appendix. Stack on #1003 exact b0b663f19453e009c9086ea12cae8570e2efbb2e. No entry/session/runtime/DDL/activation/deployment/provider changes. Independent formal approval, exact CI and parent chain remain gates. Proposed ownership is not acknowledged cross-team coordination.

TDD: fail public mount focus preservation first for both tabs; cover discard, asynchronous completion, disabled/absent actions, external focus, tab switch, denial and disposal. Implement smallest render-local map; run regressions, lint/planning and full check. Native browser evidence and installed acceptance are separate. Rollback removes only button-focus restoration. Full product remains open.

## Verification
Initial RED 0/2 passed: replaced action lost focus. GREEN seven-file regression 66 pass /0 fail /0 skip. Changed-file Biome and planning/link/contract/secret-scan PASS. Standard npm run check attempted: tsc killed by local resource limits; later chained checks did not execute. No fullcheck or native-browser/installed E2E success claimed. Row actions explicitly excluded because identical labels do not imply stable row identity.
