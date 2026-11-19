# Fresh authorized history page re-entry (#642)

- Only an existing trusted caller-owned history mount is affected. No new authority, endpoint, session cookie, retention or public entry.
- On a change to a ready/empty/unavailable/cancelled tab, reuse review.retry to re-read its exact last attempted page with applied filters. Loading clears the destination rows before any destination render. Existing loading reads are not duplicated; invalid-query state remains invalid until explicitly corrected.
- Clicking the already active tab is a no-op. Refresh current page is enabled for ready/empty pages only, and repeats the exact applied page, including its opaque cursor; it does not submit draft edits or reset pagination. Retry remains the recovery action for failure.
- Existing clients cancel superseded JSON/CSV reads and suppress late publication. Fresh 401/403 terminally clears Usage and Audit together and disposes the download epoch. Unavailable remains a generic retryable error without old records.
- No automatic polling or claim of immediate IAM revocation between requests. The outer trusted-session owner must still clear known logout/expiry/identity change. A page refresh is not a login/logout implementation.

## Acceptance evidence

RED before source change: 20 pass, 3 fail (no tab re-read; Refresh absent), /tmp/og1830-red.log.
GREEN focused seven files: 91 pass, zero fail/skip, /tmp/og1830-main-verified.log. Additional embedded-PG shared-workspace integration separately: 2 pass, /tmp/og1830-heavy.log. Owned HTTP test exercises real listener + synthetic RFC9068 JWT + embedded PostgreSQL: empty Usage, audit historical detail, required audit outage/restore, Usage navigation, IAM principal deactivation, Audit re-entry immediately hides old detail, fresh 401 clears operations. Required audit outcomes ready/ready/unauthenticated.
Initial parallel and later combined runs were resource-killed; isolated capped runs above passed. This is not the full repository suite, installed PostgreSQL, company IdP login, external ingress, provider or paid-call E2E.

## Real Chromium local evidence

Built operations-session artifact at http://127.0.0.1:18860: empty Usage -> Audit one historical record -> Refresh current page Loading with no record -> record returns -> Usage fresh Loading/empty -> synthetic IAM deactivation -> Audit re-entry Loading without historical record -> Sign-in required with no operations workspace. Server-side synthetic JWT is not delivered to browser. Initial harness disappeared during concurrent heavy work (connection refused); isolated capped harness was checked HTTP 200 before this browser run. This loopback harness is not a persistent external user URL or company SSO/login deployment.
