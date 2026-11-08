# Usage screen trusted authority expiry (#642)

1. Preserve the low-level disconnected connect transport and existing public build. Add authorize(CatalogAuthorityGrant) to the existing usage screen; no new session, endpoint, database migration or activation.
2. Accept only a future safe-integer absolute deadline supplied by a trusted adapter, never filters or UI identity. Clear previous authority before validating replacements.
3. Cancel pending work, revoke CSV URLs, erase rows, filters and navigation at expiry/logout/replacement/disposal. Timers are bounded and stale callbacks cannot clear renewed grants.
4. Gate every request and completed response against the deadline even when browser timers are suspended; check after JSON/CSV consumption before rendering or creating blobs.
5. RED/GREEN structural-DOM tests cover invalid grants, automatic expiry, suspended timers, delayed JSON/CSV, renewal, disposal and cancellation. Run typecheck, lint, focused tests and full check; request exact-head independent review and required CI before merge.
6. Entry owner must wire this trusted adapter. Explicitly distinguish structural DOM/loopback evidence from installed browser/session/provider acceptance. Existing session/runtime/schema holds remain unchanged.
