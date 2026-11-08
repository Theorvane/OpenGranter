# Integrate exact request usage filtering (#637 / #642)

1. Reuse the frontend-owned a1bbc43 request filter control/client and their tests without importing unrelated ancestry. Preserve the existing current-principal, model and correlation panels.
2. Carry the optional exact request_id through existing gateway and SSO history boundaries into the parameterized PostgreSQL query; retain principal/model/time intersection, fresh IAM and mandatory audit. No new endpoint, schema or activation.
3. RED: run original request-filter tests before production changes. GREEN: test parser, SQL lookahead, pagination, CSV, source/built UI and signed SSO public HTTP. Exclude foreign-principal rows with identical IDs and fail closed on audit failure.
4. Verify type/lint/scripts, full suite and exact-head CI independently; request formal review. Never merge without all ancestor gates. Native browser, installed IdP/PostgreSQL and paid provider acceptance remain separate.
