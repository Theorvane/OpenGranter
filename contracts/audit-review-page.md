# Opt-in audit review page (#784)

`mountManagementAudit(root)` starts disconnected and makes no requests. The trusted owner explicitly connects the bounded #782 `createManagementAuditClient`; the connection itself is not authentication. The owner must clear immediately on logout, identity/permission change or expiry, and dispose on unmount. Do not auto-connect this page to SSO or use ambient cookies. Existing server authentication, current IAM and mandatory audit remain required per page.

Apply sends exact principal/model text without trimming or normalizing. Blank means omitted. Time controls explicitly represent UTC; invalid or reversed ranges clear prior records without transport. Each query uses limit 25. First page removes continuation; next page uses the exact returned cursor and the submitted (not edited draft) filters. Every query immediately clears prior records. Superseded responses and detached button callbacks cannot restore data. Clear resets filters, client and records; dispose permanently empties the root.

Only fixed event ID, UTC time, kind, request ID, principal ID and model metadata columns are rendered with textContent. Arbitrary details, credentials, policy payloads and transport/error bodies are not rendered. Empty, invalid-query, denial, unauthenticated, cancelled and unavailable outcomes have distinct fixed messages. This component trusts only the bounded validated audit client result, not arbitrary HTTP JSON.

This source-only opt-in view does not modify the public entry, grant authority, enable a session, retain content, export CSV or complete #642 / installed acceptance. Lifecycle timers and session/CSRF/IdP decisions remain the integration owner's responsibility.
