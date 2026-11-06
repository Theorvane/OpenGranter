# Explicit revocation confirmation (#640)

The existing token screen requires a local two-step review before calling the existing revoke endpoint. This is accidental-action protection, not authorization, a credential lookup or a server lock.

- Submitting a nonempty credential ID opens an accessible named review section showing that exact ID through textContent. It performs zero requests. No existence, ownership or revocability claim is made.
- Confirm revocation dispatches the captured ID, never a later edited input. Cancel revocation makes no request. A new review replaces the previous one. Empty input cannot reach confirmation.
- Render revision plus current workspace readiness guard confirm/cancel just like all other controls. Confirm consumes the pending review before dispatch. Detached controls, repeated clicks, stale authority and busy/reconciliation states cannot send another mutation.
- Every workspace notification invalidates review; issue action, logout, renewal, expiry, secret hide, navigation/unmount and disposal cannot carry a confirmation into a new lifecycle. A notification is not permission to auto-confirm. Reopening requires an explicit new review.
- Server IAM, expiry, fresh disabled-state checks, mutation/audit atomicity and unknown-outcome latch remain authoritative. No request shape, route, session, secret persistence, reconciliation reset, production activation or provider call is added.

Acceptance: source and bundled structural DOM review/cancel/snapshot/lifecycle cases, existing host controls, plus the signed test-JWT loopback HTTP and migrated PGlite token screen integration. These are distinct from native-browser/session/installed acceptance, which remain open.
