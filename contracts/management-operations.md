# Management operations mount

Issue #637; plan: ../docs/plans/637-operations-navigation.md.

mountManagementOperations(root, request, createDownload) is an explicit trusted-caller composition, not a grant source. request MUST already enforce approved browser authority. Caller MUST dispose on logout, known expiry or identity change. The public entry is unchanged.

History initially loads the existing scoped usage API. History / Proxy tokens navigation disposes the previous child before mounting the next. Each history visit receives a fresh caller-owned HistoryDownload; ownership transfers to the mount. A throwing factory shows a generic alert without making a request. No token mutation happens until existing explicit confirmation.

Navigation clears displayed bearer tokens and aborts local requests. It neither revokes a token nor proves a pending mutation failed; the UI warns users to verify outcomes before resubmitting. Current-child 401/403 terminates all navigation and disposes children. Aborted previous-visit responses and retained detached controls cannot replace the current visit. Disposal is terminal and idempotent.

Tests: test/management-operations-app.test.ts exercises actual existing client and panel implementations with synthetic HTTP responses plus canonical browser bundling. This does not certify installed SSO, real database persistence, provider calls or downloaded-file completion.
