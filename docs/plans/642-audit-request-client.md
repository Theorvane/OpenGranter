# Exact audit request browser transport (#642)

1. Reuse existing #847 JSON and #852 page CSV clients and main #881 exact request contract; no new client, endpoint, session or UI activation.
2. Add optional exact requestId to owned scalar filter snapshots, encoded query, whole-page projection and CSV revalidation. Preserve principal/model/time/keyset intersection.
3. RED: existing clients omit request_id, accept wrong-request rows and lose CSV filter. Add rejected-input, pending-input mutation and accessor-once cases.
4. GREEN: run focused JSON/CSV clients plus actual migrated SQL + HTTP request-filter path, full TypeScript/lint and planning/security checks. Local HTTP/SQL is not browser/login/installed/provider acceptance.
5. Update existing #852; require exact-head CI and independent formal approval before merge. #847 dependency must be reconciled, not merged twice.
