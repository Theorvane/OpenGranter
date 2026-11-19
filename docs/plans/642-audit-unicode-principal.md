# Exact Unicode audit principal filters (#642)

1. Remove the ASCII-only audit principal filter restriction that prevents existing Unicode identities from being explicitly inspected. Accept nonblank exact strings up to 256 UTF-16 code units, rejecting Unicode Cc characters; do not trim, normalize or interpret identity text as a pattern.
2. Use the same bounded predicate for durable gateway audit principal actor/target projection and audit reader inputs. RED showed that parser-only changes still fail at the real store. Preserve all other identifier grammars. Retain current proxy authentication, target-specific audit:Read IAM, explicit Deny, parameterized SQL and mandatory audit. No SSO audit route, session, runtime, schema or privilege is introduced.
3. Establish RED/GREEN for Unicode exact matching, composed/decomposed distinction, invalid controls, fresh Deny and failed audit. Exercise the existing HTTP socket and real PGlite audit store/reader for bounded JSON/CSV pages. This is not installed PostgreSQL or browser/IdP acceptance.
4. Run focused tests, typecheck/lint/planning/compatibility and full check, then submit an independently reviewed PR. Require exact-head CI and formal approval before merge.

## Current main integration

Preserve main canonical shared audit extraction, request-ID filters and compatibility exports. Move the approved exact nonblank Unicode principal validator into the existing browser-safe event projection; use it for shared query validation, persisted actor/target projection and SQL reader inputs. No new browser dependency grant or authority is added. Original Unicode and main audit/browser regression suites remain intact.

The canonical browser invalid-query fixture previously rejected an internal-space principal, which the approved exact nonblank Unicode predicate intentionally accepts. Retain that invalid-input assertion using Unicode Cc instead; separately assert exact Unicode, internal-space and composed/decomposed request round-trips. Non-principal identifiers retain their strict grammar.
