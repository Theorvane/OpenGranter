# Account to proxy-token issuance preparation (#640)

The opt-in operations workspace exposes **Prepare token for this account** only after the existing canonical Account client validates a human identity from GET /management/v1/principal. It captures the exact returned ID, replaces Account with Proxy tokens, and prefills Principal ID once. It does not fetch or issue a token on this action. Expiry remains blank; the operator must enter it, review both values, and separately confirm issuance through the existing POST API.

The prefill is editable navigation data, not identity authentication or authorization. All existing fresh server IAM, owner lookup, maximum lifetimes and required audit still apply. A permission change after Account read can deny the eventual POST; a failed decision audit cannot produce a committed credential. A successful Account read does not imply permission to issue.

Refresh, navigation, denial and disposal invalidate detached Account controls. A cancelled review or later manual Proxy tokens visit does not resurrect the previous principal. Form teardown clears retained input nodes; successful token display and explicit revocation review retain their existing one-time-secret lifecycle. No automatic retry, mutation replay, expiry default or secret persistence is introduced.

Standalone Account consumers receive no new action unless they provide the explicit callback. No new endpoint, session/IdP/CSRF integration, public bootstrap, schema or deployment activation is added.

## Evidence boundaries

account-token-handoff.test.ts exercises actual DOM coordinators using structural DOM ports. account-token-handoff-http.test.ts drives those coordinators through owned Node HTTP, signed synthetic RFC9068 tokens and migrated PGlite for success, fresh explicit Deny and missing required decision-audit table. These are local synthetic integration tests, not visible browser login, installed PostgreSQL/TLS, external URL, real provider or release acceptance.
