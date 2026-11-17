# Account lifetime evidence (#639)

## Local implementation

New mountSessionCurrentPrincipal consumes a trusted existing request and absolute expiry. Starts locked; replacement, logout, expiry and disposal clear the private subtree. Delayed headers are cancelled; streamed JSON checks authority before/after reads and EOF. No public shell or authentication source is modified.

## Automated evidence

Missing-module RED: 0 pass / 1 failure in /tmp/og1630-red.log using managed Node22 arm64. Final four serial suites: 24 pass / 0 fail / 0 skip in /tmp/og1630-verified-tests.log (session9, panel6, client8, actualHTTP1). The actual HTTP scenario uses the owned Node listener, registered-key signed synthetic JWT and migrated embedded PostgreSQL; exercises identity, expiry, reauthorization, fresh IAM deactivation and delayed durable audit crossing the deadline. Initial multi-database attempts were SIGKILL; consolidated one owned database avoids concurrent/retained WASM heap pressure. Changed-file Biome and scripts/check.py pass. One pre-final full typecheck invocation completed without diagnostics, but later final attempts were OS-Killed (uncapped and capped384/256); final full typecheck is NOT locally certified and requires CI. Initial system Node lacked strip-types; use installed arm64 Node22, not x64.

## Actual browser

Local-only http://127.0.0.1:18847 built from the NEW module with buildManagementBrowser. Browser navigate: Sign-in required, no identity. Click Supply synthetic trusted grant: Account / account-human / human / Refresh account. Click Advance synthetic expiry timer: Session expired, no identity or refresh. Grant again: loading then exact identity. Click Clear caller grant: Sign-in required, no identity. These harness controls supply synthetic authority, NOT production login/logout. Server-side fixture JWT is never put in the browser. The first chosen local port was already in use; no existing process was stopped.

## Limits

No company IdP, OIDC/BFF/CSRF approval, installed TLS/PostgreSQL, external user URL, provider/paid calls, deployment or whole-product acceptance. Local harness is intentionally untracked, may remain running. Merge requires exact-head required CI and valid independent formal GitHub approval.

## Main integration — 2026-11-18 06:00 KST

Integrated reviewed main 9bc8810a2f31fb1a7714ee18c1fb369b2f605f17 (PR938) without changing the caller-owned authority/session contract. Retained canonical main versions of inherited tests and documents, then added only the Account lifetime section. Expanded the actual owned HTTP regression: a denied grant stays terminal after server-side subject rebinding; retained Refresh performs zero SQL; only a new trusted authorize reads replacement-human; clear removes it synchronously; the ordered durable audit outcomes are ready/ready/unauthenticated/ready. A first test-only SQL query used the wrong sort column id; corrected it to the existing event_id schema. This was not a production RED or a DDL change.

Final core six-suite run: 28 PASS, 0 FAIL, 0 SKIP (/tmp/og-0600-939-core.log), Node22.23.0 heap192 serial. Wider eight-suite attempt: 34 PASS and two file-level SIGKILL failures in canonical/current-principal-owned-runtime suites (/tmp/og-0600-939-focused.log); do not call the wider run passing. Standalone tsc heap256 was OS-Killed, aggregate npm run check with single CPU and heap192 exited137 during tsc (/tmp/og-0600-939-check.log). Changed-file Biome, scripts/check.py and diff whitespace checks PASS. Exact-head CI is required; local full typecheck/full check are NOT certified.

Rebuilt the integrated module in a new owned local harness at http://127.0.0.1:18847/. Native browser snapshots confirm locked/no identity -> account-human/human + Refresh -> expired/no identity or Refresh -> trusted reauthorize reads account-human -> caller clear returns locked/no identity. Loading was not captured separately. Server-side synthetic JWT and embedded PostgreSQL only; no browser credential storage, real company SSO, deployed user URL, paid provider call or installed acceptance.
