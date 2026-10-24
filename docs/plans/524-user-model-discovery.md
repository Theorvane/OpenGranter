# Proxy user model discovery

## Issue and problem

- Issue: [#524](https://github.com/Theorvane/OpenGranter/issues/524), part of #116.
- Installed OpenRouter1.4.18 models.listForUser uses a collection path currently interpreted as an OpenAI alias on the compatible base. It needs user-scoped list semantics, default text output and safe pagination.

## Scope and expected behavior

- Add GET /api/v1/models/user with the existing compatible list envelope, text output default, offset/limit/output_modalities and already-supported sort values. Unknown metadata cannot establish text output; explicit all includes basic aliases. Unpaged requests return the full authorized result; inherited local paging bounds remain in effect.
- Use current enabled model AND final-provider IAM, full catalog validation/capture and mandatory models-listed count/attribution audit. Hidden malformed metadata or catalog/audit faults fail privately. Do not call inference, routes, secrets, limits or usage.
- Keep continuations on the fixed relative user-list path with validated filters/sort and fresh authentication/policy/catalog/audit on every request. Capture projection before audit; caller-supplied identifiers never become URLs or route authority.
- Reserve literal compatible user for the collection and reject its alternate encoded model-ID spellings after authentication. Preserve /v1/models/user as an exact OpenAI model read for published aliases. Existing compatible count, general listing and singular rich lookup remain unchanged. All recognized outcomes, including Node fallback, retain no-store.
- Scope is OpenGranter proxy IAM, not import of upstream account preferences, privacy/retention/region settings or live capability certification. These remain explicit compatibility gaps. No new audit kinds, migrations or domain concepts.

## Design

- Add a narrow user-list query parser that reuses existing list validation and adds the text default. Extend continuation serialization with a closed two-path choice selected by trusted gateway flags.
- Register the exact GET collection before treating compatible IDs as OpenAI reads; share the entire existing discovery flow. Extend discovery cache classification and the existing reserved-alias guard.
- The official [OpenAPI](https://openrouter.ai/openapi.json), retrieved2026-10-25, defines listModelsUser with offset/limit/output_modalities/sort, bearer security and ModelsListResponse. Installed SDK1.4.18 exposes the first three query fields with an explicit operation bearer. Raw tests cover the supported sort subset; no unsupported performance sort is implied.
- Existing five pins and metadata schema bodies remain unchanged and do not cover this separate operation. Explicit user-operation source conformance remains future work. Update product, architecture, acceptance, compatibility, cache/retrieval contracts and handoff. No ADR/glossary update is needed.
- No unresolved decision is required for this bounded local-IAM route. Full #116 and unresolved Jev #7 remain open.

## TDD plan

- Add raw Fetch and installed OpenRouter socket cases first; record the expected not-found/wrong-envelope failures before production changes.
- Cover both route kinds, default/all/any output filters, exact supported ordering/paging and user-path continuation; explicit operation bearer, current principal isolation and fresh provider/model/implicit Deny.
- Verify query/auth ordering, duplicates/unknown/unsupported sorts, bounds, hidden catalog faults, audit failure, source mutation and private audit projection/history. Existing audit event/storage tests remain relevant without a new migration.
- Preserve count, general list, OpenRouter singular lookup and OpenAI retrieval regressions; add reserved user alias and Node fallback coverage. Run strict types/lint, focused suites and full npm run check with documented CPU-affinity scheduling if needed, retaining every test/deadline.

## Delivery

- Commit on this fresh issue branch using the authorized human author/committer, DCO and Assisted-by. Open a ready plan-linked PR and require current-head review plus successful checks.
- Risks: this deliberately reserves user on the compatible collection namespace and narrows supported query/metadata semantics. Document OpenAI retrieval collisions and upstream-preference limitations. Revert collection registration/parser/cache/reservation together if rolling back; no migration is required.
- Record actual red/green/full validation before delivery and refresh handoff with PR #523's merge checkpoint.

## Verification evidence

- Red: the initial 20 raw/installed-SDK cases ran before production edits; 18 failed because the collection route was missing or returned a bare model. Two existing auth/query cases passed. Evidence: /tmp/opengranter-524-red.log.
- First implementation exposed two continuation fixture setup errors: using a guarded Request as RequestInit read its body getter during test construction. Constructing guarded continuation requests directly corrected the fixtures; production body-reading behavior/assertions were not relaxed.
- Green: eleven focused user/general/count/single/retrieval/cache/audit/SDK suites passed all 101 cases. This includes a separate measured ResponseValidationError case for an explicit all-output SDK list containing a basic row. Evidence: /tmp/opengranter-524-focused.log and /tmp/opengranter-524-sdk.log.
- Actual SDK1.4.18 sockets verify both route kinds, explicit operation bearer over a different global key, different principals' visibility, automatic pagination, fresh Deny and no-store. Existing OpenAI7.23.0 retrieval, OpenRouter singular get and sanitized audit storage/history remain green.
- Full `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 6,999 cases, 6,998 passed, one optional external PostgreSQL skip, zero failures/cancellations. Every original test/deadline remained enabled. Types, lint, planning/link/contract/fixture-secret checks and all five offline source integrity checks passed. Existing lint warnings/infos were not modified. Evidence: /tmp/opengranter-524-check.log.
- Five pin bytes, dependency files and migrations have no diff. New user-operation structural conformance, rich metadata publication, upstream account preference/privacy/region equivalence, complete #116 and unresolved #7 remain open. No live provider/secret/accounting calls were added.
