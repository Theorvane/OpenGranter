# SSO current principal HTTP

`GET /management/v1/principal` is an explicit server-facing Bearer identity read. It is not a browser session or permission grant. The trusted PostgreSQL composition uses the registered-key RFC9068 verifier and existing fresh exact active-human binding. Every request re-verifies; caller-supplied identity, claims, headers or cookies cannot replace authentication.

- Success: 200 JSON `{ id: <current human principal ID>, kind: "human" }`. No roles, statements, policy versions, issuer, subject, raw token or expiry claims. Only the authenticated caller is returned.
- Missing/malformed/rejected Bearer or inactive/unbound/nonhuman identity: 401 unauthorized with WWW-Authenticate Bearer, after awaited denial audit. Verifier/database failure or invalid trusted authenticator result: 503 authentication_unavailable, after awaited failure audit.
- A required audit rejection returns 503 audit_unavailable and no identity. Await the callback before any identity response. Audit is a frozen exact projection `{ requestId, outcome: ready|unauthenticated|unavailable, principalId: string|null }`; only ready has an ID. No raw claims/tokens/errors. The callback is caller-owned durable infrastructure, not an optional observer.
- Generated request IDs are bounded safe ASCII (1..256). Ignore caller request IDs and actor/principal headers. Query, aborted request, any GET body, transfer-encoding or nonzero/malformed content-length: 400 invalid_request before authentication. Unknown path/method: 404 without private work.
- All responses are Cache-Control no-store and X-Content-Type-Options nosniff. Errors use existing safe client-error envelopes.
- The factory captures ports once. The PostgreSQL factory does not permit a supplied verifier/authenticator override. Node server is unbound; no runtime/ingress/migration/schema/browser/session activation occurs.

No authorization, routing, limits, provider, secret, credential mutation or usage work is performed. Current active-human identity does not imply iam:Manage, invoke permissions or any administrative role. No promise of atomic revocation after the binding read. Session expiry/CSRF/CORS/IdP and durable audit integration remain independent required deployment work.

## Concrete PostgreSQL audit option (#770)

The PostgreSQL factory now requires exactly one own writeAudit callback or auditClient configuration field. SQL mode uses the concrete dedicated identity audit store and awaits its acknowledged INSERT; optional proposed DDL is not installed automatically. Callback mode preserves the same durable obligation. See [durability and failure contract](current-principal-audit.md). No runtime mount or session grant follows.

## Existing Account compatibility (#774)

Exact GET `/management/v1/me` is also supported with the existing Account payload `{ principalId: <current human ID> }`, and no additional fields. It shares the same fresh registered-key verifier, exact active-human binding, required awaited identity audit, denial/failure privacy and malformed-shape validation as `/management/v1/principal`. The original path and `{id,kind}` projection remain unchanged. Lookalikes, trailing slash and other methods remain zero-private-work404. No URL rewriting, cookie session, new identity authority, runtime mount, schema installation or frontend change occurs. This closes a concrete wire-contract mismatch with the existing Account workspace; it does not certify that workspace in a native browser or install either server.
