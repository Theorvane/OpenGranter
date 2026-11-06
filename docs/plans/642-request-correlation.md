# Current-page request correlation (#642)

1. Extend the existing authorized usage view with content-free request/attempt correlation, using only rows already returned on the current page. Group by exact principal ID and request ID together, preserve row order and every record, and distinguish record count from distinct attempt count.
2. Show each attempt model, route, outcome, time, provider/candidate metadata, unknown usage and possible-billing/duplicate markers. Never infer retries, chronology, deduplication, settled charges or completeness across pages. Do not fetch extra records or add endpoints, sessions, permissions, runtime or schema activation.
3. Establish meaningful RED/GREEN for grouping, cross-principal collision isolation, repeated attempt IDs, Unicode/HTML-like text, unknown provider values and authority/loading clear in the mounted view. Test the compiled workspace as well as source; structural DOM/loopback HTTP is not native-browser login acceptance.
4. Run focused regression and typecheck/lint/scripts/compatibility plus full check; publish a stacked PR, obtain exact-head CI and formal independent approval before merge.
