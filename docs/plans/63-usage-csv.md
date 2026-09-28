# Usage page CSV export

## Issue and problem

- Issue: #63
- Authorized usage reviewers need CSV export. The existing endpoint returns validated, bounded JSON pages only.

## Scope and expected behavior

- GET /v1/usage accepts format=json (default) or format=csv. Unknown/repeated formats return 400.
- CSV uses identical IAM, model/time filters, cursor, and 100-row maximum. It exports one page rather than claiming complete history. Clients repeat filters with X-Next-Cursor while X-Has-More is true.
- Return text/csv UTF-8, a fixed attachment filename, request ID, and pagination headers after successful required audit.
- Export only allowlisted metadata. Unknown counts/costs are empty cells, never zero; include usage status, duplicate/possibly-billed flags, and separate estimated and billed decimal/currency/source fields.
- No content, raw credentials, new permissions, unbounded history export, audit export, or aggregation.

## Design

- A pure serializer reprojects records, quotes every field, doubles embedded quotes, and uses CRLF records. Preserve decimal amounts as strings.
- Prefix formula-looking textual cells (including whitespace/full-width variants and leading tabs/newlines) with an apostrophe. This changes underlying CSV text intentionally; JSON remains the exact machine-readable form. This reduces interpretation on initial import, not a universal guarantee across spreadsheet save/reopen behavior.
- Refer to [OWASP CSV injection guidance](https://owasp.org/www-community/attacks/CSV_Injection). No spreadsheet-specific mode is silently introduced.
- Serialize only validated rows inside the existing unavailable-read boundary; failed reads return safe JSON errors, not partial CSV. Keep the same attributed usage-read event.
- Update PRD, architecture, acceptance, and gateway scenarios.

## TDD plan

- First HTTP CSV test expects 200/text-csv and fails with the existing 400.
- Add serializer tests before production code for commas, quotes, multiline fields, formula-looking values, unknown counts, cost separation, projection, and empty-page headers.
- HTTP tests cover filtered success, continuation headers, default/explicit Deny, malformed format, storage/mixed-principal failure, and required audit failure.
- Run npm run check and record red/green evidence.

## Delivery

- This branch starts from main and remains independent of pending audit-range PR #62.
- Report page bounds, CSV text transformation, and remaining full-history export work in the PR.

## Integration update

PR #62 was approved and merged during implementation. Merge current main, preserve the audit-range and CSV contracts, and run the combined checks before publication.
