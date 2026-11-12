# Proxy-token issuance panel contract

- Only an explicit second confirmation sends one POST /management/v1/proxy-tokens, JSON {principalId, expiresAt}; no-store, redirect error, no self-supplied credentials. ID is the existing nonempty <=256 UTF-16 code-unit opaque identifier without NUL or unpaired surrogates. ExpiresAt is a nonnegative safe integer of Unix milliseconds; server enforces allowed lifetime.
- Only HTTP 201 application/json, valid UTF-8, <=131072 bytes and exact {credentialId, token} succeeds. Both fields follow server opaque rules (256 and 16384 code units). Reject extras and arrays. Do not render response or thrown error text.
- 401/403 lock and clear the panel; 400 is rejected input; all other HTTP/transport/decoding failures are uncertain (issuance may already have committed). Never automatically repeat issuance. Abort is not rollback.
- Result appears only in the current mounted authorized panel. Clear removes result; old callbacks cannot reveal it again. No storage, logs, links or clipboard. Display clearing does not revoke the token. Caller MUST dispose on logout, identity change or expiry and owns approved navigation/session integration.
- Component coverage does not certify native-browser, installed PostgreSQL/IdP or live deployment acceptance.
