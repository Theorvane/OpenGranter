# Local history page-size acceptance (#642)

## Scope

The production change adds a page-size filter to both existing history screens using the already-reviewed limit contract. Blank preserves the server default. Invalid values do not make a request. Fresh apply resets pagination. Current-page CSV, retry, previous/next and cross-view investigations use applied, destination-owned bounds.

## Executed evidence (2026-11-17, Asia/Seoul)

- DOM RED before production change: 25/25 fail on the absent page-size input.
- Final DOM regression set: 70/70 PASS, zero skips. Includes 27 new boundary, invalid-value, pagination/CSV, destination-limit and stale-control cases plus existing history/investigation regressions.
- Isolated signed-JWT owned canonical loopback HTTP with migrated PGlite: 2/2 PASS before formatting and the generic error-message clarification. Both resources exercise one-row/two-row scoped pages, cursor reset, current-page CSV, durable access audit and fresh Deny. This is real server authentication/SQL, not company IdP or native PostgreSQL acceptance.
- Actual Chromium local browser harness: Usage and Audit each show request3 with limit1, Next shows request2 only, and download produces a real UTF-8 CSV. Parsed both browser-downloaded files: exactly one data row, request2 only, no other-principal marker. Audit size101 shows an invalid-filter alert and disables pagination/export. Harness uses an explicitly labelled, isolated test identity; signing material stays in memory. Not an installed login.
- Changed-file Biome, document/contract scan and whitespace checks pass.

## Explicit non-passes

Full typecheck was SIGKILLed on the shared 4GiB computer (resource pressure; exact kill cause unverified), including one capped-heap correction. A later old-source HTTP RED attempt and a combined regression HTTP subprocess also received SIGKILL, so they are NOT a meaningful HTTP RED or regression pass. The combined build suite additionally failed to spawn npm in this shell environment. Full npm check is not claimed; exact-head CI remains required. Browser bundling itself succeeded for the actual Chromium run.

No production deployment, company SSO acquisition, cookie/session/CSRF/CORS decision, native PostgreSQL, retention, provider call, paid budget, or whole-PRD completion is established. Required CI and formal independent approval must precede merge. Parent dependency PRs remain separate.

## Current canonical integration (2026-11-20, Asia/Seoul)

Reconciled this existing #961 with current #959 (93c0870534870c659714338f630d48969e75b320), retaining already-merged #960 and the latest canonical shell/Account/Models, history identity contracts and HTTP/token lifetime handling. The PRD append conflict preserved both requirements; the history source merged without conflict. This is integration evidence, not a newly reproduced defect.

- Focused DOM and real signed-JWT/PGlite owned HTTP regressions: 38 PASS, 0 FAIL, 0 SKIP (page sizes, both scoped HTTP resources and Usage-to-Audit investigation).
- Full strict TypeScript, full Biome (42 existing warnings, 183 infos, no errors), document/contract/fixture scan and whitespace check PASS. Full standard check is pending for this exact integration; earlier resource-limited attempts remain historical, not current passes.
- Fresh Chromium at local-only http://127.0.0.1:18797/: Usage and Audit each apply size 1, show request3, navigate Next to request2 only and download actual CSV. Both downloaded CSVs parsed to exactly one data row with request2 and no other-principal marker. Audit size101 produces the invalid-filter alert and disables paging/refresh/export. The harness has an explicit isolated test identity, migrated PGlite and real loopback HTTP, not company SSO or installed/native PostgreSQL acceptance. No external accessible deployment URL is established.

Original RED evidence remains above. No new authority, session, DDL, activation, deployment or provider calls. Parent approvals and required exact-head CI remain mandatory before merge.
