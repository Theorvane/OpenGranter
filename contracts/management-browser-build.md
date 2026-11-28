# Reviewed management browser build

## Explicit shared public source grants (#853)

The trusted build caller may supply readonly publicSources root-relative paths to buildManagementBrowser or repeat --public-source PATH in the management:build CLI. The entry remains inside src/management. Only each exact canonical .ts file under the canonical repository src subtree is granted; its transitive shared dependencies need independent grants. There is no directory, wildcard, package, node module or default shared-source grant. Symlink escapes outside the source tree fail. The default management-only import restriction is unchanged.

Review source contents and the complete import closure before publishing. Explicit grants are publication decisions, not secret scanning, authority, or approval of arbitrary server code. The builder neither receives runtime secrets nor adds environment replacements. Bare imports and all non-relative dependencies remain denied, including in granted files. Existing single browser module, no source maps and atomic non-overwriting publication remain unchanged. Invalid CLI arguments retain the fixed redacted error and no module output.

Canonical FE2591928 sso-catalog-entry requires eight reviewed shared validators: src/audit/principal-reference.ts, gateway-audit-projection.ts, time-range.ts, history-filters.ts, history-http.ts, attribution.ts (the last five also under src/audit), and src/usage/record-usage.ts, record-parser.ts. Listing them documents this source snapshot only; future dependency changes require fresh review rather than widening a directory grant.

A compiled artifact and public signed-out browser execution are not session acquisition, signed bearer authentication, private SQL API acceptance, installation, or production approval. This change adds no listener, session, CSRF, IdP, DDL, provider call or IAM grant.
