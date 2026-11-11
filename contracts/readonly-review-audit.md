# Optional audit API in read-only review composition

The existing read-only review HTTP and browser factories accept optional auditHistoryClient, a caller-owned approved committed/autocommit SQL access-audit client. Presence enables only GET /management/v1/audit through the existing concrete SSO audit handler. Omission preserves 404 and zero audit-route SQL; an invalid explicit value fails construction.

Existing JWT validation, fresh audit:Read scope, filters, JSON/CSV pagination, metadata redaction and awaited per-page durable reader audit remain unchanged. No token mutation, new IAM right, session bridge, DDL promotion, socket binding or runtime default is introduced. Enabling metadata access does not authorize content retention. The caller owns schema approval, SQL lifecycle and TLS/ingress.
