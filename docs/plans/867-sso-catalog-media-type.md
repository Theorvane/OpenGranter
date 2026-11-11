# SSO catalog JSON response boundary (#641)

1. Preserve the existing SSO catalog HTTP application/json publication contract. No proxy decoder, auth/session, server policy or UI changes.
2. Reproduce list/detail accepting JSON disguised as HTML, plain text, missing or unsupported media types through the public client; require unavailable without consuming the body.
3. Gate SSO successful responses before bounded body reads, accepting JSON and UTF-8 charset forms like the usage client. Preserve status handling and cancellation.
4. Run focused client/HTTP tests, typecheck and lint. Require independent exact-head approval and all required CI before merge. This is not login/browser/installed acceptance.

## Local evidence

- Before production fix: public SSO client 8 pass / 1 fail (non-JSON incorrectly ready).
- After fix: catalog proxy/SSO clients and SSO HTTP handler 51 pass / 0 fail / 0 skip.
- Full TypeScript check, Biome check (existing warnings/information only), planning/link/secret scan and diff check pass.
- No browser login, live IdP, deployment or provider calls performed.
