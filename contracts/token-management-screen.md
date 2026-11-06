# Proxy token credential forms (#640)

`mountManagementTokens(root, workspace)` renders actual issue/revoke forms using the existing trusted transport and externally owned token workspace. It never creates, authenticates or renews a grant. The host MUST keep ONE workspace above navigation/logout/new grants and call its `authorize`/`logout` only through its separately approved authority lifecycle. Mounting this module does not activate a runtime or listener. Existing frontend-owned entry/navigation files are unchanged.

- Explicit principal ID and expiry epoch milliseconds produce the existing issue POST; credential ID opens explicit review before confirmation produces the existing revoke POST. Empty/invalid expiry is shown without dispatch. Server authorization, validation, transaction and mandatory audit remain authoritative. A false revoke acknowledgment is not shown as successful revocation.
- Ready, disconnected, pending, invalid input/request, denied, expired and reconciliation-required states are visible. No automatic retry, reconciliation reset, credential listing, provider secret entry or clipboard integration exists.
- One-time secret is rendered with textContent only, not HTML/URLs/storage/logging or callbacks. Hide, next dispatched mutation, expiry, logout, grant replacement and unmount remove it from the owning active display. Strings or previously retained DOM references are not memory-zeroized.
- Detached controls check render revision and current workspace readiness before acting, independently of disabled attributes. Completion status is bound to the authority generation, so a new grant cannot show stale success. Authority changes/terminal states clear principal, expiry and credential drafts.
- Workspace `subscribe(listener)` emits secret-free change notifications, returns an idempotent unsubscribe function, and isolates listener exceptions. `snapshot().authorityRevision` is monotonic authority-generation metadata, not an authorization capability. Subscriptions do not acquire authority. Hosts must release subscriptions.
- Dispose unsubscribes, clears the root and invokes `hideSecret` to abort/lock pending work. It never destroys or recreates the host workspace. An interrupted/ambiguous write remains locked across remount/new grants. Reload/cross-tab/server-side reconciliation remains unimplemented and separately gated.

Source and supported browser bundle forms are exercised with a structural DOM test double, and against actual ephemeral signed-JWT loopback SSO HTTP plus migrated PGlite for issue/credential verification/revoke/mandatory decision rows. This is not native-browser login, installed PostgreSQL, production deployment or live-provider evidence. Connecting this screen to the existing frontend host and the approved session/BFF/IdP/CSRF boundary remains open.


## Existing host navigation (#639/#640)

mountSsoUsageWorkspace now offers Models, Usage history and Credentials in the same existing host. It constructs exactly one private credential workspace per host mount. Navigation, clear/logout, pagehide/pageshow and grant replacement never reconstruct that workspace or reset an uncertain mutation. The public source entry remains disconnected; session/BFF/IdP/CSRF acquisition and server logout still require the approved adapter. No listener, global grant API or deployment activation is introduced.

The host supplies its validated generation-bound transport to both read screens and token forms. A current 401/403 clears all host authority; stale or aborted denials cannot clear a later grant. All host teardown paths clear the secret and abort pending writes. Navigation hides successful secret display without destroying valid authority. Interrupting a pending write blocks later credential dispatch across navigation, logout and new grants. Page restoration never restores authority. Broken clocks fail closed, and throwing timer cleanup cannot suppress host teardown.

Source and supported-artifact structural DOM tests cover actual host navigation and interrupted/denied/stale/expired/hidden controls. Signed-JWT loopback HTTP with migrated PGlite verifies host-driven issue, stored-credential verification, navigation hiding, revoke and durable mandatory decision rows. That credential-only HTTP fixture intentionally does not compose catalog routes; its initial catalog read is unsupported, not a claim of integrated catalog deployment. Native browser, approved login/session, installed PostgreSQL and full PRD acceptance remain separate outstanding gates.

The private host uses the optional workspace onAuthorityFailure notification, delivered only for a current definite 401/403 after single-flight completion. It carries only the normalized denial reason. Stale generations or a reentrant renewal suppress it, and observer errors cannot alter the result. Reads clear immediately; mutation denial completes classification before host logout so a definite rejection is not mislabeled as an interrupted write. A fresh trusted grant after definite denial can be used normally; real ambiguity remains latched.

## Explicit revoke review (#640)

Credential submission now opens a request-free exact-ID review rather than immediately sending revoke. Confirm revocation sends the captured ID only; Cancel revocation sends nothing. Workspace notifications, issue action and lifecycle changes invalidate the review. Current server authorization is rechecked on dispatch; review confers no permission or existence guarantee. See [revocation confirmation contract](token-revoke-confirmation.md).


## Issuance review (#640)

Issue token opens a request-free exact-principal/expiry review; Confirm issuance invokes the existing mutation exactly once. Cancel issuance discards review without a request. Epoch and UTC preview do not grant authority or validate current lifetime. Review cannot survive opposite action, workspace notification, lifecycle or detached controls. Existing host tests explicitly confirm before expecting dispatch; dedicated source/artifact and HTTP tests assert no dispatch before confirmation. See [plan](../docs/plans/640-issue-confirmation.md) and [contract](token-issue-confirmation.md).
