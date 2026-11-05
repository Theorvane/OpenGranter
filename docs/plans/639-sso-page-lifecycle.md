# SSO catalog page lifecycle (#639)

1. Compose the existing SSO DOM mount with an explicit browser page lifecycle port; do not change frontend-owned renderer/entry or decide session acquisition.
2. On pagehide, synchronously clear authority, abort in-flight reads and remove private DOM before a page can enter the back-forward cache. A restored page stays signed out until the trusted session integration supplies a fresh grant.
3. Keep the page inactive after pagehide; reject grants until pageshow. Ignore stale grants, callbacks and completions after disposal. Unregister both listeners on disposal. Do not clear on visibilitychange (ordinary tab changes are not logout).
4. RED: tests import the absent page composition. GREEN: event-driven DOM cases for bfcache, grants during suspension, late HTTP, reauthorization and listener cleanup. Run management regressions, typecheck and lint.
5. Open stacked PR on #690; require exact-head CI and formal review before merge.

No authentication/logout endpoint, persistence, runtime activation, CSRF/CORS/IdP policy, deployment or provider calls. Structural DOM/event tests are not an actual-browser or installed-session acceptance result. Browser screen currently unavailable; report that separately.

## Execution evidence (2026-11-05 15:00 KST run)

- Native Node22 RED: absent page module in /tmp/og-1500-page-red-module.log. Initial system Node rejected strip-types; corrected to installed native ARM Node22. First GREEN attempt exposed invalid fixture publisher (SSO accepts only opengranter); corrected test data, not production validation.
- GREEN: lifecycle3/3 and management94/94, zero skips (/tmp/og-1500-page-green-final.log, /tmp/og-1500-page-management.log). TypeScript noEmit exit0; full Biome553files exit0 with existing warnings/info; planning/link/fixture scan and six offline schema pins pass.
- Page browser and desktop both report Team Computer screen still being released. No actual-browser, bfcache-engine, installed auth, PostgreSQL or live-provider result is claimed.
- Composition is exported but not activated; frontend owns integration into its entry with an actual Window and a trusted session grant.
