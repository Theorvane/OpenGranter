# SSO current principal HTTP

`GET /management/v1/principal` is an explicit server-facing Bearer identity read. It is not a browser session or permission grant. The trusted PostgreSQL composition uses the registered-key RFC9068 verifier and existing fresh exact active-human binding. Every request re-verifies; caller-supplied identity, claims, headers or cookies cannot replace authentication.

- Success: 200 JSON `{ id: <current human principal ID>, kind: "human" }`. No roles, statements, policy versions, issuer, subject, raw token or expiry claims. Only the authenticated caller is returned.
- Missing/malformed/rejected Bearer or inactive/unbound/nonhuman identity: 401 unauthorized with WWW-Authenticate Bearer, after awaited denial audit. Verifier/database failure or invalid trusted authenticator result: 503 authentication_unavailable, after awaited failure audit.
- A required audit rejection returns 503 audit_unavailable and no identity. Await the callback before any identity response. Audit is a frozen exact projection `{ requestId, outcome: ready|unauthenticated|unavailable, principalId: string|null }`; only ready has an ID. No raw claims/tokens/errors. The callback is caller-owned durable infrastructure, not an optional observer.
- Generated request IDs are bounded safe ASCII (1..256). Ignore caller request IDs and actor/principal headers. Query, aborted request, any GET body, transfer-encoding or nonzero/malformed content-length: 400 invalid_request before authentication. Unknown path/method: 404 without private work.
- All responses are Cache-Control no-store and X-Content-Type-Options nosniff. Errors use existing safe client-error envelopes.
- The factory captures ports once. The PostgreSQL factory does not permit a supplied verifier/authenticator override. Node server is unbound; no runtime/ingress/migration/schema/browser/session activation occurs.

No authorization, routing, limits, provider, secret, credential mutation or usage work is performed. Current active-human identity does not imply iam:Manage, invoke permissions or any administrative role. No promise of atomic revocation after the binding read. Session expiry/CSRF/CORS/IdP and durable audit integration remain independent required deployment work.
