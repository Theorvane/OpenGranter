# 641: Explicit informational SSO catalog publication

1. Scope: PRD model discovery and #641 catalog display through the existing SSO API to the existing DOM renderer. Preserve the frontend-owned DOM/app/entry. No session acquisition, activation, permissions, writes, pricing, routing or inference changes.
2. Contract: deliberately extend the reviewed basic SSO envelope with optional administrator-published name (nonblank, <=256 code units), description (<=8192), and context_length (null for unknown or nonnegative safe integer). Legacy publications omit these fields. This replaces the earlier basic-only contract explicitly, not by reusing the entire proxy metadata envelope. Never publish canonical/upstream IDs, architecture, prices, capabilities, references, claims or policy content. Do not infer values from provider configuration.
3. RED: signed-test-JWT + migrated PGlite + actual loopback Node HTTP + SSO UI transport must retain these three fields on both list/detail; current service/HTTP/client each strips them. Add invalid-field HTTP rejection and no-extra-field projection checks. Preserve fresh IAM, revoked binding and mandatory durable audit failure checks.
4. GREEN: explicitly project validated stored metadata at service, validate/project at HTTP, and retain only these fields in SSO transport. Existing DOM already renders them as text, not HTML. Run all catalog tests, full typecheck/lint and script checks. Record local and CI separately.
5. Review: exact-HEAD independent formal approval plus all required CI before merge. No browser login/company IdP/installed database/provider/E2E acceptance is implied. Session/CSRF/ingress approval remains required for activation.

## Execution evidence (2026-11-08 14:30 KST)

- RED: 10 passed / 2 failed in SSO client and persisted HTTP suites: the exact optional fields were stripped; /tmp/og-1430-red.log.
- GREEN: all catalog tests 241/241 passed, zero failed/skipped, including actual loopback Node HTTP, signed test JWTs, migrated PGlite, no-store/error projection, fresh IAM denial, identity revocation and durable audit failure; /tmp/og-1430-all-catalog.log. This is not company SSO, browser/login or installed acceptance.
- Full typecheck, full lint (42 warnings / 160 infos, no errors), script planning/link checks, pinned compatibility schemas and git diff --check passed. These are not full-suite or CI results.
- Prior PR793 local full suite finished 9197 tests: 9185 passed / 11 failed SIGKILL / 1 skipped. Its exact-head seven CI checks and formal approval passed before merge dc00fc3; local full-pass is not claimed.
- No DOM/app/entry file changed; no runnable authenticated browser URL is established by this change.
