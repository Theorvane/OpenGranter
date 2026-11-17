# History filter reset (#642)

## 1. Scope and design
Add an explicit Reset filters action to the active history view for administrators recovering from invalid filters or investigating a request. Clear applied/draft request, model, time, page-size and cursor state. Restore the optional initial principal exactly; never silently broaden an account-targeted mount. The inactive view is unchanged. Use the existing authorized JSON client and cancellation. No new endpoint, authority, session, retention or billing behavior.

## 2. TDD
Add failing public-mount cases for both tabs, initial target restoration, sibling isolation and stale controls after disposal/denial. Assert exact query parameters and cleared inputs. Add the smallest button implementation; run mount/workspace/runtime/browser-build tests, strict typecheck, lint, docs checks and full check.

## 3. Delivery
Update PRD, architecture, acceptance and contract. Require exact-head CI and independent formal approval plus parent gates. Tests using a DOM port do not certify native browser, company IdP, PostgreSQL or provider E2E. No production or paid calls. User-requested reset makes a fresh authenticated read; no unresolved permission contract is changed.

## 4. Evidence
RED: 25 existing mount tests passed and all three initial reset tests failed because the action was absent. GREEN: mount suite plus two additional invalid-query/pending-cursor cases passes; combined mount/workspace/runtime/browser-build suite 59/59, zero skip. Existing signed synthetic JWT, migrated embedded PGlite, owned HTTP/build/runtime-port integration suite 8/8, zero skip (not a native browser or company IdP). Strict full typecheck, repository lint (42 existing warnings/174 infos), planning/link/contract/fixture-secret and diff checks pass. Full npm run check started before PR; outcome tracked in execution handoff.
