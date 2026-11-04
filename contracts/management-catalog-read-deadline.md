# Management catalog read deadline

Refs #637/#639 and [plan](../docs/plans/639-catalog-read-deadline.md).

Each authorized catalog list/detail read has a fixed 30-second deadline covering transport and JSON body consumption. Expiry aborts the request and settles the existing unavailable state, even when an injected transport ignores AbortSignal. No automatic retry or raw error text is exposed. Navigation or invalidation settles obsolete work as cancelled immediately; late results cannot replace current content. Completed reads clear their timer and abort listener. Server authorization and auditing remain unchanged; cancellation does not roll back server work. The bound is subject to browser event-loop scheduling, not a real-time guarantee or a server timeout.

No authentication, session, runtime listener, grant source, credentials, deployment or provider call is added. Existing presentation displays the unavailable/retry state; this does not certify actual browser SSO or installed API acceptance.
