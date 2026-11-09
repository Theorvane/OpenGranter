# Addressable SSO Models before success audit (#637, #641)

1. Preserve the existing SSO HTTP alias grammar. Before production changes reproduce a SQL publication accepted by the catalog reader but rejected by the Models HTTP projection. Use migrated PGlite, signed ephemeral JWT, loopback HTTP and independent durable audit queries.
2. Extract the unchanged HTTP alias predicate to a server-only shared module. Validate IAM-visible SSO aliases before returning ready or writing success audit. Invalid visible results yield catalog_unavailable and unavailable/count-zero audit, never partial data. Do not change the global catalog reader.
3. Cover empty/dot path components, valid aliases, denied models, fresh policy versions and failed audit. Do not expose alias diagnostics or credentials.
4. Run focused Models/SQL/HTTP/audit tests, full typecheck, lint and planning checks. Submit a stacked PR and request exact-HEAD formal review and CI. No UI/session/schema/runtime activation or installed/provider acceptance is claimed.

Contract: [SSO Models](../../contracts/sso-model-catalog.md).
