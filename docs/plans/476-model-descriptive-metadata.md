# Descriptive model metadata plan

## Issue and problem

- Issue #476; external-client gate #116 and unresolved #7 remain open.
- The metadata allowlist rejects standard optional model description, expiration_date and knowledge_cutoff, preventing administrator-published descriptive information from reaching authorized clients.

## Scope and expected behavior

- Accept own optional description strings of 0..8192 UTF-16 units and own optional expiration_date/knowledge_cutoff strings of 0..256 units or null. Preserve exact text, empty/whitespace strings, explicit date null and omission independently. Supplied undefined, invalid types, description null and oversized values reject the entire snapshot safely.
- Dates remain opaque informational strings. Official prose describes YYYY-MM-DD, but the structural schema and installed SDK do not validate dates. Do not parse/coerce dates, invent defaults, automatically disable past-expiration aliases, alter IAM/routes/limits or expand search/sort. Administrator review, stricter calendar policy and automatic refresh remain separate decisions.
- Existing complete metadata requirements and legacy/basic payloads stay unchanged. Whole-catalog validation precedes enabled model AND final-provider IAM, filters/order/paging and required sanitized audit. These fields occur only in compatible response rows; no metadata in operational errors/events.
- Listing invokes no inference, routing, secret, limit or usage ports. PostgreSQL listing/route resolution share the same immutable validation. Existing JSONB object and 64 KiB cap remain; no migration/backfill/provisioning API.

## Design

- Extend the TypeScript metadata interface and allowlist; capture own scalar fields once in the frozen snapshot using a bounded string helper that permits blank text, distinct from required nonblank names/identifiers.
- The [official OpenAPI](https://openrouter.ai/openapi.json) defines optional string description and optional string/null dates without format/pattern/default/bounds. Existing model-response pin selects all three already. Installed OpenRouter 1.4.18 maps dates to expirationDate/knowledgeCutoff; OpenAI 7.23.0 preserves raw extra JSON fields despite their absence from its declared Model type.
- [Official models reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) describes removal as possible after expiration and cutoff as training-data information. No timezone, precise removal, revocation or selected-provider guarantee is assumed. Local lengths are explicit bounded compatibility restrictions.
- Reuse existing HTTP metadata projection and PostgreSQL boundary; all three pins remain byte-identical. No new glossary term or costly irreversible trade-off/ADR.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [base contract](../../contracts/model-discovery-metadata.md) and [extension contract](../../contracts/model-descriptive-metadata.md).

## TDD plan

- First public regression expects authorized rich rows with exact optional strings/null; current allowlist returns 503. Actual SDK socket probes reproduce rejection before production edits.
- Cover omissions, empty/blank/newline/Unicode text, UTF-16 bounds, date null/arbitrary/past strings, invalid scalar types and own undefined, inherited omission, getters read once/throw and source mutation during audit. Verify implicit/model/provider/explicit Deny, authentication, required audit/catalog failure, hidden malformed metadata, basic/legacy responses, unchanged search/order and no inference ports.
- Verify fake PostgreSQL listing/route resolution, sanitized failures, snapshot mutation, migrated PGlite JSONB round trips and existing 64 KiB cap. SDK tests include richer rows, null/omission, pagination and fresh Deny on both SDKs.
- Smallest implementation: three optional fields, scalar helper and conditional frozen projection. Format changed files, focused discovery/storage/SDK cases and npm run check; record meaningful red/green.

## Delivery

- Issue/branch/plan before code; publish exact reviewed PR after full checks. Both exact-head check jobs and sjungwon03-ai approval precede sjungwon03 squash merge.
- Rollback is code-only, but snapshots containing newly supported fields would reject under the old validator until removed. Metadata is stale/informational and client rendering must treat descriptions as data. Description markup/links are preserved as JSON text, never fetched or executed by the gateway. Stronger date policy, management/refresh, complete discovery/#116 and unresolved #7 remain open.

## Verification evidence

Accept administrator-published optional description, expiration_date and knowledge_cutoff in complete compatible model snapshots. Preserve exact strings, blank descriptions, nullable dates and omission with explicit UTF-16 limits; validate and capture own values once. Dates remain informational and do not disable a past-expiration alias, change its approved route or expand search/order.

The existing shared HTTP/PostgreSQL snapshot boundary supplies the fields after complete-catalog validation, enabled model/final-provider IAM and required private audit. Legacy/basic payloads and the nullable JSONB object/64 KiB cap remain unchanged. Actual OpenRouter 1.4.18/OpenAI 7.23.0 sockets preserve the fields, pages and fresh-policy denial. Update the PRD, architecture, acceptance and contracts; all three source pins remain byte-identical.

TDD: node --experimental-strip-types --test test/model-descriptive-metadata.test.ts test/sdk-model-descriptive-metadata.test.ts first produced 26 passes and 28 expected failures: valid descriptive snapshots returned 503 instead of 200, PostgreSQL rejected them, and SDK calls received catalog_unavailable. The same 54 cases pass after the minimum validator extension. Initial test syntax was corrected before recording this behavioral red run. Full npm run check passes with 5715 tests and one existing PostgreSQL skip.

Risks/remaining scope: text lengths and own-property capture are local restrictions; source date prose does not imply calendar validation or automatic revocation. Published metadata may be stale and does not certify selected-provider capability or billed cost. Downgrading the validator requires removing newly supported stored fields. Description markup is JSON data and is never fetched/executed by the gateway. Metadata publication/refresh, broader discovery fields, strict dates, full #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 5715 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
