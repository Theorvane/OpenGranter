# Shared token-management panel contract (#640)

mountTokenManagementPanel(root, request) mounts issuance and revocation and returns dispose(). The caller supplies an approved authorized CatalogRequest and must dispose on identity/logout/known expiry/navigation. No credential acquisition, session inference, persistence, clipboard, logging or provider calls.

- Mount, review and cancel send no requests. Existing explicit-confirmation and exact HTTP contracts remain unchanged.
- Fresh 401/403 from either operation irreversibly stops both children, clears owned one-time secret nodes (including detached nodes), aborts pending sibling work and renders a safe sign-in/access-denied message. No automatic recovery or retry; remount only under fresh caller-established authority.
- Explicit disposal is idempotent, clears all owned UI, aborts pending operations and suppresses stale callbacks/late completions. Separate mounted instances do not share state.
- Network/server/malformed responses keep child uncertain-outcome semantics and never fabricate authorization results. Cancellation or clearing does not revoke tokens or imply rollback.
- Boundary rendering is presentation, not server authorization. Every actual mutation remains authenticated/authorized/audited by the existing server. Canonical navigation/session integration and installed/live acceptance remain separate gates.

## Issued-token revocation handoff (#640)
The composed canonical token panel offers Review revocation of issued token after successful issuance. This passes only the exact credential ID to the existing revocation review, clears owned one-time secret nodes, and still requires a separate Confirm revocation before any POST. Cancel or clearing does not revoke. Prior unsubmitted review controls become stale; in-flight revocation cannot be replaced and shows a generic busy status while preserving the one-time display for retry. No automatic retry, new authority, endpoint, public-entry activation or session behavior. See [plan](../docs/plans/640-issued-token-revocation.md).
