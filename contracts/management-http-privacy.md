# Management HTTP privacy

Issue #639. The shared Node request server sets Cache-Control: no-store and X-Content-Type-Options: nosniff on exact /management and all slash descendants. The bridge overrides conflicting child headers for all methods and status codes, including missing routes and unexpected-error fallback. The URL pathname, not query values or similar prefixes, selects the policy. Existing discovery protections remain unchanged.

Transport headers do not authenticate requests or enable any management routes. Existing authorization and audit requirements remain authoritative. Default fixed error envelopes and custom fallback status/body are preserved; no private thrown error is reflected. No cookies, CORS, CSRF, session, runtime activation, browser memory guarantee or ingress configuration is introduced.

A custom transport error factory is not trusted to succeed: before committing fallback headers/status/body, the bridge validates its status and Node header values and reads its body. A factory exception, invalid status/header, or unreadable/consumed body falls back to the fixed format-specific 500 envelope. Failed custom fallback headers and partial body bytes are not emitted. This contains async request-listener rejection; it does not recover from a response already sent to the client, which is terminated as before.
