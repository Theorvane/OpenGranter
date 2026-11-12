# Shared token-management panel contract (#640)

mountTokenManagementPanel(root, request) mounts issuance and revocation and returns dispose(). The caller supplies an approved authorized CatalogRequest and must dispose on identity/logout/known expiry/navigation. No credential acquisition, session inference, persistence, clipboard, logging or provider calls.

- Mount, review and cancel send no requests. Existing explicit-confirmation and exact HTTP contracts remain unchanged.
- Fresh 401/403 from either operation irreversibly stops both children, clears owned one-time secret nodes (including detached nodes), aborts pending sibling work and renders a safe sign-in/access-denied message. No automatic recovery or retry; remount only under fresh caller-established authority.
- Explicit disposal is idempotent, clears all owned UI, aborts pending operations and suppresses stale callbacks/late completions. Separate mounted instances do not share state.
- Network/server/malformed responses keep child uncertain-outcome semantics and never fabricate authorization results. Cancellation or clearing does not revoke tokens or imply rollback.
- Boundary rendering is presentation, not server authorization. Every actual mutation remains authenticated/authorized/audited by the existing server. Canonical navigation/session integration and installed/live acceptance remain separate gates.
