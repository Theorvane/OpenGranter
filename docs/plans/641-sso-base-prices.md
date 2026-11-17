# SSO catalog published base prices (#641)

1. Extend the existing authenticated read contract only with optional exact published prompt/completion prices (USD per token). Never infer billed cost, discounts, overrides, routing authority or capability. Legacy metadata-less rows omit pricing.
2. RED: show real migrated PGlite, registered-key signed SSO and HTTP lose published prices; verify safe serialization and malformed service output.
3. GREEN: project only two validated decimal strings after unchanged current binding, IAM and mandatory durable audit. Reject malformed present output; unknown nested fields are stripped.
4. Run focused API/security regressions, typecheck, lint and planning checks. Require exact-HEAD required CI and independent formal approval before merge.
5. No session, DDL, runtime composition, startup activation, browser parser or deployment changes. Frontend owns UI adoption. Local HTTP is not installed/company-IdP/provider acceptance.

## Execution evidence

- RED: 19 passed, 2 failed: published prices disappeared at real SSO HTTP and trusted-service HTTP projections.
- GREEN: 57 passed, 0 failed, 0 skipped across catalog HTTP, durable composition, catalog service, SSO audit and owned runtime regressions. Real local HTTP sockets, migrated PGlite and registered-key signed test JWTs verified exact decimal/zero prices, current Deny/revocation and failed-audit suppression. Frontend parser still intentionally omits this optional field pending owner adoption.
- Full TypeScript and Biome passed (42 existing warnings, 160 infos); planning/link/contract scans, all pinned schema checks and whitespace checks passed. No full local suite, native browser, company IdP, installed PostgreSQL, provider or deployment success is claimed.
- No merge until exact-HEAD required CI and valid formal independent approval.
