# Administrator-published descriptive metadata

Issue #476. Plan: [476-model-descriptive-metadata](../docs/plans/476-model-descriptive-metadata.md).

A complete configured openRouterMetadata snapshot may add own optional description:string (0..8192 UTF-16 units), expiration_date:string|null and knowledge_cutoff:string|null (each string 0..256 units). Preserve exact text, whitespace/newlines/empty strings, explicit date null and omission. Supplied undefined/nonstring scalars, description null and oversized values invalidate the entire snapshot with existing safe errors. Optional inherited fields are omitted; each supplied value is captured once and included in the frozen snapshot. Getter failures produce fixed errors without retry or coercion.

Only enabled model AND final-provider IAM-authorized aliases expose these values in GET /api/v1/models rows, after full catalog validation and any existing filter/order/paging. /v1 and unconfigured basic aliases remain unchanged. No description/date search, ordering, clock comparison, automatic expiry, route selection, pricing/capability guarantee or authority derives from these fields. Dates are opaque informational values; the official prose describes YYYY-MM-DD, while the selected structural schema and SDK accept plain strings without format validation. Administrator publication review remains required; stronger date/expiration policy is unresolved.

Required sanitized audit precedes output. Metadata never enters operational errors/events; listing invokes no inference/route/secret/limit/usage ports. Hidden/disabled/out-of-page malformed metadata still invalidates the entire catalog. Captured values cannot change during audit awaits. Each continuation rechecks current catalog/IAM; there is no snapshot guarantee.

PostgreSQL catalog listing and route resolution validate/capture the same optional fields. Valid descriptive fields do not alter route contents. Existing JSONB object/64KiB limit and absent/null storage remain unchanged; no migration/backfill or automatic source refresh. Stored snapshots are administrator informational data, not trusted instructions for client rendering.

Installed OpenRouter 1.4.18 consumes description and camelCase expirationDate/knowledgeCutoff; OpenAI 7.23.0 preserves raw snake_case JSON fields despite narrower declared Model types. SDK/storage/public cases cover exact values, bounds, omission/null, required failures, Deny and mutation. Existing three source pins already cover these schemas and stay byte-identical; runtime coverage does not certify full discovery or #116. Metadata provisioning/refresh, other optional fields, strict dates, automatic expiration and unresolved #7 remain open.

Sources checked 2026-10-06: [official schema](https://openrouter.ai/openapi.json), [models reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties). Local text lengths and own-property capture are explicit restrictions, not source-schema bounds.
