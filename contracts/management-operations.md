# Management operations mount

Issue #637; plan: ../docs/plans/637-operations-navigation.md.

mountManagementOperations(root, request, createDownload) is an explicit trusted-caller composition, not a grant source. request MUST already enforce approved browser authority. Caller MUST dispose on logout, known expiry or identity change. The public entry is unchanged.

History initially loads the existing scoped usage API. History / Proxy tokens navigation disposes the previous child before mounting the next. Each history visit receives a fresh caller-owned HistoryDownload; ownership transfers to the mount. A throwing factory shows a generic alert without making a request. No token mutation happens until existing explicit confirmation.

Navigation clears displayed bearer tokens and aborts local requests. It neither revokes a token nor proves a pending mutation failed; the UI warns users to verify outcomes before resubmitting. Current-child 401/403 terminates all navigation and disposes children. Aborted previous-visit responses and retained detached controls cannot replace the current visit. Disposal is terminal and idempotent.

Tests: test/management-operations-app.test.ts exercises actual existing client and panel implementations with synthetic HTTP responses plus canonical browser bundling. This does not certify installed SSO, real database persistence, provider calls or downloaded-file completion.

## Trusted-session lifecycle adapter

Issue #637; plan: ../docs/plans/637-operations-session.md.

mountSessionManagementOperations(root, createDownload, options?) begins unauthenticated without requests. Only an approved caller may invoke authorize(CatalogAuthorityGrant) with the existing trusted request port and absolute expiry; no UI input is promoted to authority. Call clear() on logout/identity change, or authorize the replacement grant. dispose() is terminal and clears the root. No public entry or authentication source is activated.

Valid authorization schedules expiry before mounting existing history/token operations. Known expiry removes retained issued-token text, aborts pending local work and releases download ownership. Clock uncertainty/invalid deadlines fail closed. Check the clock before requests, after headers and before delivering each body chunk or EOF as well as on timer delivery. Body reads use no prefetch, preserve backpressure and existing client size limits, and cancel the source on rejected reads or caller cancellation; source diagnostics remain private. A successful status before expiry cannot publish a token whose body completes after expiry even if the timer never fires. Cap long timer delays and re-arm early callbacks. Scheduling failure leaves generic unavailable UI with no request. Cleanup diagnostics never become UI text.

Current non-aborted 401/403 terminates the grant; aborted prior-screen responses and stale grants/timers cannot terminate a replacement. Isolated per-grant DOM prevents reentrant teardown from clearing a replacement mount. Local teardown does not revoke credentials, prove mutation rollback or replace server authentication/IAM. Tests: test/management-operations-session.test.ts; synthetic boundaries only, not installed SSO acceptance.


## Models navigation in trusted operations (#637)

The opt-in operations mount provides Models alongside History and Proxy tokens. Models uses the existing SSO /management/v1/models list/detail contract, bounded decoder and text-only renderer; it never falls back to proxy discovery. Loading, empty, missing and unavailable states permit the existing safe retry actions. Navigation aborts and disposes the prior screen; returning reloads the current scoped catalog. Retained controls cannot request or republish old data. A current 401/403 terminates all operations navigation; a stale denial cannot terminate its replacement. The existing trusted-session wrapper still owns expiry/logout. No authentication source or public entry is enabled, and this does not certify installed SSO or provider access. See docs/plans/637-operations-catalog.md (repository-root relative).


## Published model information in trusted operations (#637)

The opt-in Models detail screen displays existing validated SSO name, description, context/output bounds, modality and parameter labels, and exact prompt/completion base rates in USD/token. Missing fields display Not published, null bounds Unknown, and empty label arrays None published; zero and decimal/scientific strings remain exact. Text-only rendering prevents metadata markup execution. Publications are not verified capabilities, enforced quotas, routing authority or billed request costs. Existing authentication/IAM/audit and expiry/logout/denial/navigation teardown remain unchanged. This is display-only, not CRUD, session acquisition or installed acceptance. See [plan](../docs/plans/637-operations-model-details.md).

Cases: rich data is text-only; unknown/absent/empty/zero remain distinct; malformed pricing suppresses the entire detail through the existing parser; loading, 401/403/503, back navigation and disposal remove stale publication. Test: test/management-operations-model-details.test.ts.
