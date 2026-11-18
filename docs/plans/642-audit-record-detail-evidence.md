# Audit detail execution evidence, 2026-11-16

- Base PR940 exact89bfdf7d879a34cf51f33da273630b1425a349ec. New isolated worktree /tmp/og-20261116-1730; original worktrees preserved.
- Meaningful preimplementation RED: existing history test requires native details and exact references; 14 pass, 1 fail (missing details). /tmp/og1730-audit-red.log.
- Final seven-file focused regression: 71 pass, 0 fail, 0 skip. /tmp/og1730-audit-final.log. Includes owned Node HTTP, synthetic RFC9068 JWT and embedded PostgreSQL: empty usage -> audit detail with historical credential/policy v7 and count2 -> mandatory audit table outage hides data -> restore and retry -> IAM deactivation -> fresh reload401 removes workspace. Durable access rows ready/ready/unauthenticated. A test initially expected only ready/ready; corrected to acknowledge actual mandatory denial audit, not changed runtime.
- Full-repository TypeScript passed /tmp/og1730-audit-tsc-verified.log. Initial unrestricted compiler was resource-killed; GOMAXPROCS2 exposed test typing mistakes, then corrected and passed. Not a full local test suite/fullcheck.
- Browser: built operations-session artifact at loopback http://127.0.0.1:18858, real Chromium. Usage empty -> Audit one collapsed record -> native expansion shows event1, historical-request, historical-credential, old-policy/v7 and allowlisted count2 -> Usage removes detail DOM -> synthetic IAM deactivate -> Audit can show its prior authorized snapshot until fresh Apply filters -> Loading clears detail -> Sign-in required with no workspace. JWT stayed server-side; no token mutation. Browser snapshot verifies expanded content and terminal boundary.
- Local harness is synthetic test-only, identity now inactive. Not a persistent/external user URL, company SSO login/logout, TLS, installed PostgreSQL, deployed acceptance or real provider/paid E2E. No production or paid calls. Session/IdP/CSRF and deployment gates unchanged.

## Main integration revalidation — 2026-11-18 22:03 KST

- Resumed pre-existing merge of main852823c (merged PR940). Preserved both sides of documentation and existing Account lifetime/CSP/HTTP cleanup contracts.
- Extended actual HTTP regression: restored IAM after terminal denial cannot revive detached controls; explicit trusted reauthorization restores a fresh workspace; Account deactivation removes audit details and prevents stale Account/audit controls from querying SQL.
- Direct execution: 29 unit tests passed; unrestricted embedded-SQL process SIGKILL, then isolated 256MiB heap rerun passed actual HTTP integration (1/1, zero skip). Logs /tmp/og-2203-941-tests.log and /tmp/og-2203-941-http256.log. First run was not fully passing.
- Full TypeScript passed with GOMAXPROCS=2 and 512MiB JS heap; changed-file Biome, scripts/check.py and six pinned schema checks passed. Full npm check and new-head CI/approval remain pending. No new native browser or installed SSO/deployment acceptance in this resumption.
