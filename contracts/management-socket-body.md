# Management request-body socket ownership

Refs #640; [plan](../docs/plans/640-management-socket-cancellation.md).

Cancelling a management Fetch request body stops the isolated Node readable without destroying the shared response socket. The response can finish before upload EOF. If incoming input has not ended, the server disables keep-alive and closes after the response instead of draining an unbounded upload or reusing unread request bytes. Actual client disconnect still propagates abort.

Oversized or invalid UTF-8 issuance/revocation bodies return the existing no-store 400 envelope/request ID and perform no mutation. Authentication and auditing precede validation as before; no proxy, retry, timeout, permission, session, body-size or schema change is introduced. Other proxy streaming adapters are unchanged.
