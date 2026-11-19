# Opt-in canonical SSO operations HTTP (#637)

- Add createPostgresSsoOperationsHandler and an unbound Node server factory. Existing canonical review remains read-only; existing deployment services are not changed.
- Exact /management/v1/proxy-tokens and /management/v1/proxy-tokens/revoke use existing human SSO token management. Models list/detail and canonical usage/audit JSON/CSV use existing read handlers, with fresh authorization and mandatory audit. No new authority, public API semantics or identity provisioning.
- Caller provides one committed/autocommit SQL client and validated RFC9068 trust configuration. No callback audit bypass. One optional public JavaScript shell has the existing validation/security headers; shell access never authorizes API access.
- Missing/invalid SSO, disabled identity, current Deny and durable audit failure retain existing private failures. Proxy credentials cannot authenticate as SSO. No secret appears in read history; issuance returns the existing one-time token response only.
- Unknown paths, wrong token methods and query/body validation retain the existing handlers behavior. No routing to inference, arbitrary SQL, cookies or automatic listeners.
- Acceptance is migrated embedded SQL and actual bound loopback Node HTTP. Browser login, external IdP, installed PostgreSQL, deployed TLS and live provider acceptance remain outstanding.

The shared composition makes all token responses no-store/nosniff, including authentication failures, and contains unexpected composition failures as private503. CanonicalOperations factory names are compatibility exports for stacked callers, not a separate router or runtime.
