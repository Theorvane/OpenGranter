# Operations catalog integration

The explicit trusted operations mount offers Models alongside History and Proxy tokens. Selecting Models fetches the existing SSO /management/v1/models list, and selecting an authorized model fetches its encoded detail path. Back to models performs a fresh list read. Loading, empty, missing and unavailable states reuse the existing catalog renderer. No route configuration, policy edit, mutation or inference is offered.

The caller-supplied request remains the only authority source; the caller must dispose on logout, expiry or identity change. There is no invented expiry, browser activation, proxy-token fallback or credential storage. Current 401/403 terminates the entire operations mount; stale aborted replies cannot terminate a newer screen. Navigation and disposal abort catalog reads, clear the current DOM and fence retained model/list buttons against further requests. New visits fetch fresh server authorization rather than reusing catalog results.

Acceptance: list/detail/back exact GET routes and no-store; loading/empty/error/retry; denied current list/detail clears all navigation; stale replies and detached controls cannot mutate a new screen; browser-only bundle and trusted session regressions remain valid. Local synthetic tests are not company SSO, installed PostgreSQL, provider or deployment acceptance.
