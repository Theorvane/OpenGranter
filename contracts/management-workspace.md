# Trusted management workspace

Opt-in mountSessionManagementWorkspace(root, createDownload, options) accepts the existing trusted CatalogAuthorityGrant. It is not a session issuer, BFF, CSRF implementation or permission decision. Requests still require server authentication/IAM. Public catalog entry remains locked and unchanged.

Models is the initial view and uses existing signed-SSO catalog list/detail APIs. Operations links existing history (usage/audit/CSV) and proxy-token issue/revoke screens. Native buttons provide navigation. Loading, empty, missing and generic-error states come from those existing adapters.

Navigation disposes the old screen, aborts local reads and clears one-time token output. Returning to a screen refetches; no cross-screen cache or persisted credential is introduced. A pending mutation can still complete; clearing never revokes a token or rolls back a write.

Known expiry, logout, identity replacement, disposal and active-screen 401/403 clear the entire workspace, including navigation. Expiry is rechecked on navigation and dispatch and active replies; timers are bounded and rearmed. Stale replies/events cannot affect a new screen/session. Clock/scheduler uncertainty fails closed. Trusted caller must call clear on logout/identity change; no global/storage/token-input grant source exists.

Evidence must distinguish synthetic DOM and real local HTTP with synthetic authorized ports from installed browser login, database and real-provider acceptance. This adapter alone does not activate a user-accessible deployment.
