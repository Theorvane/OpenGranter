# Current principal Account panel

Issue #639. Explicit trusted caller supplies the authorized request port to mountCurrentPrincipalPanel(root, request). No browser session, storage, credential bridge or shell activation. Loading, exact text identity, refresh and sanitized retryable unavailable states; 401/403 are terminal. Refresh and disposal immediately remove identity and invalidate pending reads. Detached controls cannot restart requests. Caller must dispose on logout, expiry or identity change. Identity display never grants IAM permissions.

Acceptance: successful read and fresh deactivation through actual owned HTTP and durable PostgreSQL audit; loading, retry, denial, malformed response, stale producer and detached-control unit cases. Embedded database/synthetic JWT are not real IdP/browser login or installed deployment evidence.
