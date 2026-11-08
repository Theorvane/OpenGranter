# UTC usage review controls (#642)

1. Replace operator-only epoch time inputs with explicitly UTC datetime controls, preserving exclusive end, millisecond precision and the existing from_ms/to_ms API contract. Render record time in readable UTC with safe epoch fallback outside the Date range.
2. Parse strictly without local-zone interpretation or calendar normalization. Invalid, pre-epoch and reversed ranges must issue no HTTP request and clear prior private records/CSV through existing invalid-query handling.
3. Add RED/GREEN parser and UI acceptance tests for exact timestamps, leap days, invalid dates, query and CSV preservation. Do not change session, runtime, schemas or authorization.
4. Verify focused tests, typecheck, lint, planning, full checks and publish a reviewed exact-head PR. Installed/native browser/provider acceptance remains separate; no merge without required CI and formal approval.
