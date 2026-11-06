# Credential detail contract (#640)

Trusted internal createPostgresProxyCredentialDetail(client) accepts exact principalId, credentialId and observedAt. It returns a redacted CredentialHistoryEntry or null. Null deliberately does not distinguish missing and other-principal credentials. The caller must authenticate, authorize the exact target and durably audit before exposing any metadata; this module grants no access and writes no read events.

- Validated, parameterized exact lookup; no scan of unrelated credentials and no token digest selection.
- Only credentialId, principalId, createdAt, expiresAt, revokedAt and observational state. Revoked takes precedence; expiry is inclusive. Reads are fresh database observations, not snapshots across navigation and not authentication checks.
- Malformed input rejects before SQL with fixed InvalidCredentialDetailInput. Invalid cardinality, scope, identifiers, timestamps or driver output/failure rejects with fixed CredentialDetailUnavailable, no partial data or driver details.
- Existing migration002 unchanged. No public route or IAM/session/runtime activation. UI/API read authorization and mandatory audit remain unimplemented, not implied by iam:Manage for issue/revoke.
- Acceptance: exact lookup projection, absent isolation, lifecycle boundaries, pre-SQL input denial, corrupt-result rejection, private errors, async input capture, migrated issue/list/detail/revoke/verify lifecycle.
