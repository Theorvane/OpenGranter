# Operations grant cancellation (#639)

## Scope
Connect each existing trusted operations grant to its own AbortController. Invalidate it before child cleanup on logout, replacement, known expiry, server 401/403, construction failure or disposal. Combine the grant signal with the consumer signal. Preserve per-response status, no late bytes, fresh server authorization and existing UI/entry ownership. Cancellation is not mutation rollback or credential revocation. No new session, IdP, policy or activation contract.

## TDD and delivery
First assert synchronous transport abort on reentrant logout during mount, and terminal disposal of completed transport signals on logout/replacement/expiry/401/403/disposal. Run against the unchanged implementation and record RED. Implement the minimal lifetime and run operations/account/transport regressions, strict typecheck, lint and full check. Exact-head CI and independent formal approval remain merge gates.
