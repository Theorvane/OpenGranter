# SSO catalog DOM integration (#641)

1. Reuse the frontend renderer unchanged from 35eaae477365a8c6bf8cea26690ecba9e726a49b; do not alter its owned branch or proxy entry.
2. Add an explicitly named SSO mount that connects the existing SSO authority to native list/detail/search/loading/empty/error views. Trusted callers alone supply request and expiry; never acquire credentials or activate a browser session.
3. RED: import the absent SSO mount. GREEN: DOM-port tests for navigation, errors, expiry, identity replacement, stale completion and disposal; loopback HTTP uses the real SSO handler with a test service only.
4. Typecheck, lint and focused regressions; open a stacked PR, request exact-head formal review and wait for required CI. No merge without both gates.

Not acceptance: fixture services/structural DOM are not a browser, real IAM, installed PostgreSQL, OIDC login, provider E2E or deployment. Session/BFF/DDL activation remains on hold.

## Execution evidence (2026-11-05 14:30 KST run)

- Corrected RED: absent module ERR_MODULE_NOT_FOUND in /tmp/og-1430-dom-red-export.log. Initial test syntax failed first and was corrected; not counted as functional RED.
- GREEN: management regression 91/91, zero skips; new DOM/loopback cases 4/4. Native TypeScript noEmit, Biome full tree and planning checks pass; six offline compatibility pins pass.
- Public local fixture built through production browser builder and served HTTP200 at http://127.0.0.1:4187/management. Browser navigation and desktop observation both blocked by Team Computer screen release error, so no real-browser success is claimed. Fixture service has no actual authentication, IAM or database and must not be deployed.
- Earlier PR689 full direct test run: 9097 total, 9096 pass, zero fail, one skip. This is not a zero-skip or installed acceptance claim.
