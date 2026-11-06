# Browser proxy-token administration transport (#640)

## Authority and scope

`createManagementTokenClient(request)` captures a trusted `CatalogRequest`. It does not authenticate, acquire/store a bearer, mount a listener, activate a browser session, accept cookies or grant permissions. Its host must dispose on logout, expiry, identity/permission change and unmount. The trusted request port must preserve the existing [SSO management HTTP](sso-management-http.md) authentication, current owner-scoped IAM, required decision audit and atomic lifecycle behavior. No raw provider-secret redisplay is introduced. There is no UI/runtime composition or deployment activation in this change.

## Operations

- `issue({principalId, expiresAt})` POSTs the exact snapshotted object to `/management/v1/proxy-tokens`. Validated 201 returns `{state:'issued', credentialId, token}` with no extra fields. IDs preserve exact Unicode and outer whitespace; they are 1..256 UTF-16 units, well formed and NUL-free. Expiry is a nonnegative safe integer in epoch milliseconds. The server owns current clock, owner kind and lifetime caps. The returned token is validated against the existing 1..16384 well-formed NUL-free string contract.
- `revoke({credentialId})` POSTs to `/management/v1/proxy-tokens/revoke`. Validated 200 returns `{state:'revoked', revoked:boolean}`. `false` is an acknowledged already-revoked result, not a failure or permission bypass.
- Exact own input keys are required. Unknown actor/policy/cap fields, invalid IDs and invalid expiry return `invalid_input` before any request. No identity is supplied by this client.
- Both operations use POST JSON, no-store, credentials omit and redirect error. Only the trusted port may supply independently approved authority; it must not forward secrets to an unrelated origin.

## Mutations and uncertain outcomes

One mutation per client may run at once; overlapping actions return `busy` without dispatch. There is no automatic retry or replay of either operation. A fixed 30-second deadline, dispose, transport rejection, unexpected status, malformed success, invalid encoding or oversized body returns `outcome_unknown` after dispatch. Neither abortion nor a 5xx proves rollback. A valid credential may exist even when its secret was not received.

After an unknown outcome the client is locked: later valid mutations return `reconciliation_required` without dispatch. There is deliberately no reset/retry method. The caller must reconcile using separately authorized operator mechanisms before creating a fresh client; request IDs are not idempotency. This client does not claim to provide the missing credential inventory or recovery UI. Explicit server 400/401/403 return `invalid_request`/`unauthenticated`/`denied` without reflecting or parsing private error bodies. Disposed clients return `disposed` and cannot dispatch; late responses are discarded and cannot return a late secret.

Success JSON is streamed into a bounded 64 KiB byte buffer, fatal UTF-8 decoded and validated. The buffer is cleared after decoding; there is no general JS memory-erasure guarantee. The client stores no returned credential/secret, never logs/persists it and supplies it only in that operation's promise result. The host remains responsible for text-only one-time display, removal and caller-held references. The client cannot retract an already delivered promise value or establish protection from an untrusted server/host.

## Evidence

Source and the actual supported management-browser artifact execute against loopback HTTP and synthetic trusted ports, plus the registered-key SSO handler with signed test JWTs, migrated embedded PostgreSQL-compatible SQL, actual credential verification, current IAM changes, durable decision audit and revocation. Tests cover denied mutations, failed audit, unknown-outcome lock, double submission, timeout, uncooperative dispatch/body, disposal, malformed/oversized/private responses and strict input projection. This is not native-browser IdP, installed PostgreSQL, production, provider or paid-call acceptance. Session/IdP/CSRF decisions and frontend screen integration remain separate gates.
