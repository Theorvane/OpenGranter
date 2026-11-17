# Caller-authorized canonical Account transport

createCurrentPrincipalClient(request) exposes read() and invalidate(). The existing caller supplies authority; this is not login, session validation or a grant. It sends GET /management/v1/principal with cache no-store, redirect error and Accept application/json; it never adds cookies, Authorization or credentials.

Only a 200 JSON response containing exactly id and kind (human) can become ready. ID follows the canonical 1–256 character non-NUL Unicode contract; malformed UTF-16 is rejected. Output is freshly projected and frozen. No request headers or raw errors are returned. 401 is unauthenticated, 403 denied, all other errors unavailable. Non-success bodies are cancelled without reading.

Successful bodies require application/json (optional UTF-8 charset), fatal UTF-8 and at most4096 bytes. A 30-second deadline includes transport and body consumption. Starting a read or calling invalidate aborts the previous epoch; even transports ignoring AbortSignal cannot publish old identity. Cancelled/stale body producers receive best-effort cancellation. No retry or public browser entry activation.

Acceptance: exact active identity over loopback Node HTTP + migrated embedded PostgreSQL and signed test JWT; revocation and missing required audit suppress identity. Separate client tests cover malformed/oversized/extra-field/invalid-content-type responses, failures, supersession, explicit invalidation and stream cleanup. These do not certify real SSO, browser login or installed deployment.
