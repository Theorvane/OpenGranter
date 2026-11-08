# SSO audit browser transport (#637 / #642)

1. Reserve only new client/tests/contract; frontend owns UI and authority. Reuse SSO audit HTTP grammar/projection, not proxy /v1/audit or usage cursor.
2. Inject CatalogRequest and trusted current principal. Snapshot and validate filters before awaits. No session, DDL, activation or authority invention.
3. RED missing module; GREEN actual loopback HTTP JSON/CSV/paging/empty/denied/anonymous/unavailable; malformed headers, scope/time/model/order/limit; unknown-field redaction; bounded UTF8 and invalidation/supersession.
4. Return projected metadata only, private errors discarded, no invented cursors or automatic all-pages export. CSV server scope/redaction remains authoritative.
5. Focused tests/typecheck/lint/scripts, draft PR, exact-head full CI and valid independent formal approval before merge. Not completed UI/session/installed/provider acceptance.
