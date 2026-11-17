# 639: Optional management browser on the owned SSO listener

1. Scope: connect the reviewed public module and browser HTTP boundary to the migrated SSO runtime. PRD R1 and issue #639 require an executable entry. No default activation, deployment, session or IAM change.
2. Contract: trusted bootstrap may explicitly provide browserJavascript. Only /management, /management/ and /management/app.js are public. All other requests retain fresh RFC 9068 SSO/IAM/audit. No token bridge, cookies, redirects, storage or upstream calls. Artifact is reviewed public code, not request input or a secret-scanning mechanism.
3. RED: explicit artifact on migrated loopback runtime returns HTML/module rather than 404. Invalid artifacts reject before opening a database connection. Default behavior remains 404.
4. GREEN: real HTTP plus embedded PostgreSQL migrations prove assets, CSP/cache, unauthenticated API audit, authenticated IAM deny, no proxy endpoint, repeated close and default-off. Run existing SSO runtime and browser/build suites. Embedded SQL/generated JWTs are not installed SSO/provider acceptance.
5. Integration: bootstrap passes reviewed build output plus existing SSO configuration to startPostgresSsoManagementGateway. Caller owns approved bind/TLS/ingress/bootstrap/shutdown. No runtime build dependency. UI app and trusted session/catalog adapter are separate.
6. Release: exact-HEAD CI and independent formal approval before merge. No production activation; live login/logout, installed PostgreSQL and provider acceptance unverified.

## Execution evidence (2026-11-04)

- RED: 1 passed / 2 failed before runtime code: browser 404 and missing early validation (/tmp/og-1230-red.log).
- GREEN: 38/38 tests, no failures or skips, Node 22.23.4 ARM64 (/tmp/og-1230-final-suite.log). Covers actual reviewed management authority build served over HTTP, embedded PostgreSQL migrations, fresh signed fixture SSO with IAM default deny, auth-denial audit, default-off, invalid input before acquisition, startup cleanup and existing direct/dual/SSO runtime shutdown behavior. This is a built library integration, not the pending DOM app entry or live SSO login.
- Full typecheck passed; full Biome passed with 42 existing warnings and 148 infos; planning/link checks and whitespace checks passed. Local logs are not CI or installed deployment evidence.
- Example integration: explicitly build the reviewed src/management entry using management:build, then pass the resulting public JavaScript string as browserJavascript in trusted startPostgresSsoManagementGateway bootstrap. No esbuild import is added to production runtime. Browser URL is the caller-approved listener origin plus /management. Default gateway npm start does not activate this separate SSO listener.
