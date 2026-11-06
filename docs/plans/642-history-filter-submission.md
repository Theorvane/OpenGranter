# 642 Keyboard history filter submission

1. Reuse existing usage/audit filter parsing and load functions. Render semantic named forms with a submit button, support Enter and programmatic submission without browser navigation. No new authority, route, session, or persistence.
2. Preserve current server-compatible validation/error correction (novalidate), reset opaque paging on new filters, keep Clear non-submitting. Bind both button and submit to the same render/deadline guard.
3. RED/GREEN source and supported artifact: submit reaches existing endpoint exactly once, invalid range stays editable without a request, detached form after navigation/renewal/logout/expiry/disposal cannot act.
4. Run all management/integration tests, typecheck/lint, exact-head CI and independent formal review before merge. Structural event tests do not certify native browser Enter or deployed login.
