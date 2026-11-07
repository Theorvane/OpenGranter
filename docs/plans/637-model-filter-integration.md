# Integrate existing model usage filter (#637)

1. Reuse only frontend commit 716e298 atop PR755; preserve component ownership and the existing authorized usage endpoint. No session/runtime/schema activation.
2. RED: existing source and browser-artifact tests require the missing group filter control; the action must retain submitted principal/time/page-size scope and reset cursor/history/drafts.
3. Integrate existing controls, then extend signed SSO real HTTP and migrated embedded SQL acceptance: explicit click, exact alias, fresh IAM and mandatory audit, expiry/stale-control denial.
4. GREEN: focused tests, browser-artifact build, typecheck, lint and full check. Native-browser/installed PostgreSQL/IdP/provider evidence stays separate.
5. Submit dependent PR; exact-head CI, valid independent formal approval and ancestor gates are required before merge.
