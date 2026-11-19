# Account-scoped history handoff

An explicitly mounted Operations Account panel may offer `View history for this account` after the existing current-principal client validates a human identity. Standalone Account remains unchanged without the optional callback. The action captures the exact ID; refresh, navigation and disposal invalidate detached actions.

The history workspace optionally receives this ID as the initial editable principal filter for both usage and audit. It immediately loads usage through the existing canonical SSO client; switching to audit issues its own authorized GET. No identity-to-permission inference is permitted. In particular, an **explicit** usage principal filter requires existing `usage:ReadAll`, even when equal to the actor ID; unfiltered/manual history retains its existing `usage:ReadSelf` behavior. Audit continues to require `audit:Read` on the target principal. The Account screen explains this distinction. Do not fall back to an unfiltered request after denial or invalid input.

History clients retain their different existing identifier-validation contracts. Unsupported input yields `invalid_query` locally in the corresponding client, never target coercion. Filters remain editable and independent per tab; existing pagination, retries and CSV use the selected filters. Manual History navigation starts without the Account default. Render/dispose clears retained input elements; disposal also clears draft maps and filters. Existing 401/403 handling terminates the complete operations epoch. A 503 retains a generic retryable failure, not private server text.

No new endpoint, policy grant, DDL, session/CSRF contract, entry activation, deployment or provider call. The optional Account audit table remains explicitly installed in tests only, not added to default migrations.

## Evidence

- `test/account-history-navigation.test.ts`: exact encoded ID, usage/audit navigation, input teardown, stale actions, unsupported identifiers, denial and safe unavailable state.
- `test/account-history-navigation-http.test.ts`: actual owned Node HTTP listener, signed synthetic RFC9068 JWT and migrated PGlite; explicit-target usage and audit succeed, policy Deny changed after Account read returns 403, missing required usage audit table returns 503. Listener/DB close verified.

This is not browser login, installed PostgreSQL/TLS, an external execution URL, live provider E2E or original-PRD completion.

## Adapter initialization recovery
If creating the History download adapter fails before any history request, the explicit Retry history action retains the exact Account target captured by that visit. Unsupported targets stay invalid locally; denial terminates the epoch and unavailable remains scoped/retryable. This does not fall back to unfiltered/self history. Explicit manual History navigation still clears the Account default. Detached retry controls cannot restart a retired visit.
