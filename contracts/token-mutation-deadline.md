# Proxy-token client operation lifetime

Both issueManagementToken and revokeManagementToken bound the entire request and body read to 10 seconds. The default applies without caller options; neither request nor stream can extend the bound by ignoring abort. Existing exact response and byte-limit validation remains required.

- A timeout returns uncertain and aborts the internal transport signal. The mutation may already have committed. It is not a failure/rollback/revocation guarantee and never causes automatic retry.
- Caller cancellation returns cancelled promptly even for an abort-ignoring port; this is likewise not rollback. Already-cancelled callers do not invoke the port.
- The bound covers stalled headers, stalled body, and unfinished streams, not just the initial request promise. Cancel response bodies when interrupted or when a late response arrives. Discard late success/credentials and consume late rejection safely.
- A fresh response received before interruption preserves existing success, invalid-input, unauthenticated and denied semantics. Input validation still precedes any request.
- Clear the timer and detach caller listeners after settlement. A completed operation is not aborted by a later caller cancellation or elapsed deadline.
- Panels already render uncertain as potentially committed and remain responsible for explicit new confirmation. No implicit re-send or secret persistence. The authorized caller MUST still dispose on logout/identity change/expiry.
- No authentication, IAM, lifetime cap, audit, server timeout, session, CSRF, database or provider changes. This client behavior does not certify canonical browser navigation, live SSO or deployed acceptance.
