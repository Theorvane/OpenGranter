# Catalog capability display transport (#641)

1. Preserve only already-published input/output modality arrays and supported parameters in list/detail transport; no server publication or auth changes.
2. Match discovery bounds: up to 64 unique nonblank strings, each at most 128 UTF-16 units; preserve exact order and open labels, empty arrays and omission. Architecture requires both modality arrays; exclude modality/tokenizer and arbitrary siblings. Freeze projected nested objects/arrays.
3. RED/GREEN tests cover list/detail, malformed metadata and real local managed/delegated HTTP with fresh Deny and mandatory audit. These are fixture-authenticated API tests, not company SSO, browser, installed PostgreSQL or live provider acceptance.
4. Run typecheck/lint and focused tests, request independent exact-head formal review and require all CI before merge. Frontend owns rendering; capability metadata is informational, not runtime support/routing authority.
