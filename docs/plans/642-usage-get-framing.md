# Usage GET framing parity (#637, #642)

1. Reuse the existing SSO usage handler and its fresh identity/IAM/audit service; preserve the unactivated deployment/session boundary.
2. Reproduce the missing GET framing rejection in signed-token PGlite Fetch and loopback Node HTTP tests. Audit and Models already reject these headers, while the Node adapter intentionally omits GET bodies.
3. Reject Transfer-Encoding and any Content-Length other than the exact normalized string `0` before calling history.read, returning fixed private 400 responses. Keep body, method and cancellation guards unchanged.
4. Prove rejected JSON/CSV reads execute no identity/usage SQL and no service audit, matching existing syntactic rejection. Valid absent/zero-length reads still apply fresh IAM and awaited audit and return authorized JSON/CSV.
5. Run focused RED/GREEN, related adapter tests, full typecheck, changed lint and script checks. Obtain exact-head required CI and independent formal approval before merge.

No request-smuggling immunity claim: Node/proxies retain their own parser/ingress responsibilities. Local HTTP + signed synthetic IdP + PGlite is not installed PostgreSQL, real SSO/browser or provider E2E. No authority, runtime mount, migration, credential, paid call or deployment change.
