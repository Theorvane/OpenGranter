# Existing host audit navigation (#642)

Audit history mounts the existing metadata-only audit screen in mountSsoUsageWorkspace. It receives the same generation-bound request port and deadline as Models, Usage history and Credentials. It fetches only after a trusted grant. Every API request remains subject to server IAM and mandatory audit. No new role, authentication, retention or permission is implied by navigation.

Navigation disposes the previous view and cancels its requests. Late pages cannot populate another view. CSV object URLs are revoked on navigation, logout and grant replacement. Detached export/refresh controls cannot use replacement authority. A current 401/403 clears the entire host, including credential authority. Expiry, pagehide and dispose remove history and authority.

The existing /v1/audit JSON/CSV API is reused, not remapped to a new SSO route. The source-only SSO review composition currently does not expose it. Unsupported adapters must show unavailable; there is no new session adapter, installed endpoint, listener, migration or public-entry activation.

Evidence separates mock-port source/artifact lifecycle tests from actual loopback HTTP + migrated PGlite host history/CSV/scoped IAM/mandatory audit tests. The latter uses a test authentication port, not registered-key SSO or a native browser.
