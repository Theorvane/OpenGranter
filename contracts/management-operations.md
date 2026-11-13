# Management operations mount

Issue #637; plan: ../docs/plans/637-operations-navigation.md.

mountManagementOperations(root, request, createDownload) is an explicit trusted-caller composition, not a grant source. request MUST already enforce approved browser authority. Caller MUST dispose on logout, known expiry or identity change. The public entry is unchanged.

History initially loads the existing scoped usage API. History / Proxy tokens navigation disposes the previous child before mounting the next. Each history visit receives a fresh caller-owned HistoryDownload; ownership transfers to the mount. A throwing factory shows a generic alert without making a request. No token mutation happens until existing explicit confirmation.

Navigation clears displayed bearer tokens and aborts local requests. It neither revokes a token nor proves a pending mutation failed; the UI warns users to verify outcomes before resubmitting. Current-child 401/403 terminates all navigation and disposes children. Aborted previous-visit responses and retained detached controls cannot replace the current visit. Disposal is terminal and idempotent.

Tests: test/management-operations-app.test.ts exercises actual existing client and panel implementations with synthetic HTTP responses plus canonical browser bundling. This does not certify installed SSO, real database persistence, provider calls or downloaded-file completion.

## Trusted-session lifecycle adapter

Issue #637; plan: ../docs/plans/637-operations-session.md.

mountSessionManagementOperations(root, createDownload, options?) begins unauthenticated without requests. Only an approved caller may invoke authorize(CatalogAuthorityGrant) with the existing trusted request port and absolute expiry; no UI input is promoted to authority. Call clear() on logout/identity change, or authorize the replacement grant. dispose() is terminal and clears the root. No public entry or authentication source is activated.

Valid authorization schedules expiry before mounting existing history/token operations. Known expiry removes retained issued-token text, aborts pending local work and releases download ownership. Clock uncertainty/invalid deadlines fail closed. Check the clock before requests and after completion as well as on timer delivery. Cap long timer delays and re-arm early callbacks. Scheduling failure leaves generic unavailable UI with no request. Cleanup diagnostics never become UI text.

Current non-aborted 401/403 terminates the grant; aborted prior-screen responses and stale grants/timers cannot terminate a replacement. Isolated per-grant DOM prevents reentrant teardown from clearing a replacement mount. Local teardown does not revoke credentials, prove mutation rollback or replace server authentication/IAM. Tests: test/management-operations-session.test.ts; synthetic boundaries only, not installed SSO acceptance.
