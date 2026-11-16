# Account lifetime evidence (#639)

## Local implementation

New mountSessionCurrentPrincipal consumes a trusted existing request and absolute expiry. Starts locked; replacement, logout, expiry and disposal clear the private subtree. Delayed headers are cancelled; streamed JSON checks authority before/after reads and EOF. No public shell or authentication source is modified.

## Automated evidence

Missing-module RED: 0 pass / 1 failure in /tmp/og1630-red.log using managed Node22 arm64. Final four serial suites: 24 pass / 0 fail / 0 skip in /tmp/og1630-verified-tests.log (session9, panel6, client8, actualHTTP1). The actual HTTP scenario uses the owned Node listener, registered-key signed synthetic JWT and migrated embedded PostgreSQL; exercises identity, expiry, reauthorization, fresh IAM deactivation and delayed durable audit crossing the deadline. Initial multi-database attempts were SIGKILL; consolidated one owned database avoids concurrent/retained WASM heap pressure. Changed-file Biome and scripts/check.py pass. One pre-final full typecheck invocation completed without diagnostics, but later final attempts were OS-Killed (uncapped and capped384/256); final full typecheck is NOT locally certified and requires CI. Initial system Node lacked strip-types; use installed arm64 Node22, not x64.

## Actual browser

Local-only http://127.0.0.1:18847 built from the NEW module with buildManagementBrowser. Browser navigate: Sign-in required, no identity. Click Supply synthetic trusted grant: Account / account-human / human / Refresh account. Click Advance synthetic expiry timer: Session expired, no identity or refresh. Grant again: loading then exact identity. Click Clear caller grant: Sign-in required, no identity. These harness controls supply synthetic authority, NOT production login/logout. Server-side fixture JWT is never put in the browser. The first chosen local port was already in use; no existing process was stopped.

## Limits

No company IdP, OIDC/BFF/CSRF approval, installed TLS/PostgreSQL, external user URL, provider/paid calls, deployment or whole-product acceptance. Local harness is intentionally untracked, may remain running. Merge requires exact-head required CI and valid independent formal GitHub approval.
