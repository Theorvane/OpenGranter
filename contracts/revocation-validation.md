# Proxy-token revocation rejection (#640)

The existing POST /management/v1/proxy-tokens/revoke contract and IAM/audit enforcement are unchanged. The management client maps HTTP 400 to its existing invalid_input outcome; 401/403 remain unauthenticated/denied, successful exact JSON remains ready, and transport/503/malformed success remains uncertain. The response body is cancelled without reading or displaying private diagnostics. No automatic retries occur.

The panel renders a fixed rejection message and a new blank Credential ID form. A corrected request still requires Review revocation and a new Confirm revocation. Detached confirmation buttons remain inert. A rejection neither claims successful revocation nor reports an unknown mutation outcome. Unknown outcomes continue to warn that a mutation may have completed. Denial removes the form; caller disposal remains required on logout/expiry/identity change.

Executable evidence: test/revocation-validation-http.test.ts uses an actual loopback listener with explicit synthetic authentication/service ports, not a company IdP, PostgreSQL installation or deployed browser session. It covers validation rejection, correction/confirmation, successful revocation, uncertain failure, denial and stale replay. Existing lifecycle and mutation-deadline suites remain required. See [plan](../docs/plans/640-revocation-validation.md).
