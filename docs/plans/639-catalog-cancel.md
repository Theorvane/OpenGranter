# Cancellable model catalog reads (#639)

1. Preserve approved catalog transport, current server IAM/audit and trusted grant expiry. No session acquisition, proxy/SSO translation, API or runtime changes.
2. Expose explicit cancellation while a list or detail read is loading. Abort transport and suppress late data; cancellation is not rollback of a server read or audit. Preserve the existing deadline and permit an explicit new list read.
3. Guard every SSO DOM action with the rendered snapshot identity and fresh expiry check. Detached cancel/list/detail controls must not affect newer navigation or renewed authority.
4. Establish failing source and supported-bundle DOM tests, then implement minimal session/authority/view composition. Test hanging transport, cancellation, retry, late data, denial, expiry, renewal and disposal.
5. Run focused integration and static checks; submit exact-head CI and independent formal review. No native-browser login or installed deployment certification.
