# #642 Usage public build integration

## Goal
Make the existing usage screen build through the reviewed management browser builder, rather than only an unrestricted esbuild test. Preserve server-module restrictions and all authorization, accounting and session decisions.

## Contract and scope
Extract the existing content-free stored usage parser into a pure module, preserving the history export for server callers. Allow exactly that parser, record normalization and attribution validation as shared public dependencies. Canonical real paths must remain beneath this checkout; shared modules are not entry points. No new server directory or arbitrary external import permission. No runtime activation, migration, session or API change.

## Steps
1. Reproduce actual usage app/client failure through buildManagementBrowser.
2. Extract parser without behavior changes; point client at the pure parser.
3. Permit only canonical named public dependencies; retain symlink and entry restrictions.
4. Exercise built client unknown usage and redaction, built app export, forbidden server and shared-entry cases.
5. Run focused tests, typecheck, lint, full check, CI and independent exact-head review before merge.

## Acceptance
Actual usage app and client produce self-contained browser modules, no Buffer/Node/server runtime dependencies. Unknown usage stays unknown. Unexpected fields are stripped. Server modules, packages, outside paths and symlink escapes remain rejected. This proves build integration, not DOM, installed session or provider acceptance.

## Risks and open decisions
The shared allowlist is a source-review boundary, not a secret scanner. Future imports fail closed. Installed usage mount, schema promotion, SSO/session and real browser acceptance remain separate gates.
