# Durable SSO catalog metadata audit

Issue #641 / parent #637. The server-only append port accepts SsoCatalogAuditEvent produced by fresh SSO catalog reads. It records server-clock milliseconds, trusted request ID, operation, outcome, model count, actual principal ID and policy versions in sso_catalog_audit_events. Anonymous authentication/unavailable events require null principal/policies. Authenticated events require a principal and policy array; unauthenticated cannot carry attribution. Missing is detail-only. Non-ready counts are zero; ready detail count is one.

Only known metadata is projected. Tokens, cookies, content, model aliases, synthetic credential IDs and arbitrary properties are never serialized. Invalid input fails before SQL. SQL, clock and malformed acknowledgement failures throw fixed errors. The catalog service maps append failure to audit_unavailable and releases no models. There is no automatic retry or uniqueness guarantee.

Migration 012 adds a separate table without editing historical SQL or weakening gateway attribution. Backend must explicitly compose append into writeAudit; no runtime mount, browser session, permissions or provider execution changes. Database roles/retention/export, tamper resistance, installed PostgreSQL and company-IdP/browser acceptance remain separate release gates.

Acceptance: public adapter tests persist actual human/policy attribution and explicit anonymous outcomes; invalid inputs cause no query; storage/clock failures fail closed; the existing loopback HTTP + signed-JWT + fully migrated PGlite scenario uses this real store, checks fresh policy versions and observes HTTP 503 after the audit table becomes unavailable.
