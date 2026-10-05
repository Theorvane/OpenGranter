# Authorized model discovery exploration plan

## Issue and problem

- Issue #460; release gate #116 remains open. The implemented discovery query subset omits official input_modalities, q and sort, despite the required administrator metadata and alias creation values already being available.
- Official schema and installed OpenRouter1.4.18 serialize all three scalar fields. Prose specifies four input tokens, context descending and creation descending; query matching/case/ties/multi-value combination are unspecified.

## Scope and expected behavior

- Only GET /api/v1/models adds optional singleton input_modalities=text/image/audio/file, q literal substring search across alias and published name/canonical_slug, and sort=newest/context-high-to-low. All fields occur at most once; unknown sort/modalities, comma-input lists, empty/outer-whitespace/control queries and search beyond 256 Unicode code points reject before catalog reads. Preserve internal spaces/punctuation literally; case folding uses locale-independent Unicode toLowerCase with no regex, wildcard, accent or normalization equivalence.
- Authenticate first; validate the whole catalog, including disabled/denied/out-of-page models, then enabled model/final-provider IAM, all supplied conditions, stable descending sort, then paging. Unknown input metadata cannot establish membership. Basic aliases can match their alias and sort by creation; null/absent context sorts after known zero. Ties retain trusted catalog order. Omitted sort retains current order. Creation means administrator-published alias creation, not a provider freshness guarantee.
- Search/filter/sort-only requests preserve full lists when both paging fields are absent. Matching authorized totals and fixed relative next links retain all accepted fields. Fresh catalog/IAM applies per request; concurrent changes can shift pages. Never search hidden models or upstream/provider IDs. Listing calls no routes/secrets/limits/inference/usage ports; query/metadata stay out of operational records/errors.
- Extend separate query pin to version2 with exactly eight complete parameter objects; preserve every previous five selection canonically and the version30 chat pin byte-for-byte. Full official sort enum/open-value extension remains source data, not runtime support. New q/input string schemas have no source bounds/defaults/enums; local semantics stay explicit.

## Design

- Extend the pure parser/captured query scalars and relative continuation helper. Apply predicates to existing frozen metadata after IAM; sort a newly filtered array without mutating the source catalog. Keep responses constructed before required audit so asynchronous mutation cannot change matched metadata, order or output.
- Use published primary context only; ignore top-provider limits. Search existing public identities rather than add a fuzzy index/new metadata. Implement only two grounded sorts; pricing/benchmark sorting requires additional cost/data policy and remains deferred. Singleton input avoids unresolved upstream OR/AND semantics. No new domain term or costly irreversible decision; existing continuation authorization covers this reversible documented subset.
- Update PRD/architecture/acceptance/compatibility plus [contract](../../contracts/model-discovery-exploration.md), existing discovery/paging contracts and source-guard contract/README. Sources: [official reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [models guide](https://openrouter.ai/docs/guides/overview/models), [official schema](https://openrouter.ai/openapi.json).

## TDD plan

- First public/installed SDK tests expect valid exploration requests; old parser rejects400. Source projection cases expect three new fields/version2 and detect structural drift; old five-field projector ignores them. Record meaningful failures before code.
- Input membership for four tokens on both route kinds, missing/empty metadata, conjunction with current filters, literal alias/name/slug Unicode/case/punctuation/internal spaces, q code-point boundaries/invalid classes, both stable sorts/ties/zero/null/basic aliases and omitted order. Filter-only lists over500, safe beyond-end offsets and all eight continuation fields.
- Authentication first, implicit/model/provider Deny, disabled matches, malformed hidden/out-of-page catalog, catalog/audit failures, audit-time source mutation, safe operational projection and no inference-side ports. Actual SDK iteration/terminal pages/fresh IAM and malformed query rejection on both SDKs; legacy /v1 queries remain rejected.
- Extend independent query-source shapes/negative integrity tests, version1 rejection and canonical removal equality. Format, focused public/socket/schema tests, npm run check and fresh fixed-host drift for both pins.

## Delivery

- Issue/new branch/plan, tests/red, smallest code/pin, focused/full green, exact published diff review, both required CI jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risks: stale/model-level metadata cannot certify live endpoint support; substring case folding is a local behavior, creation/context order does not imply provider/model eligibility. Tied catalog and changed policy/catalog can shift offset pages. No migration; rollback restores rejected fields and query-pin version1 together.
- Multi-values, fuzzy/ranked/locale search, other sorts/provider/region fields, metadata refresh, instance/reference/response certification, full #116 and unresolved #7 remain open.

## Verification evidence

Compatible GET /api/v1/models now adds singleton input_modalities=text/image/audio/file, q literal case-insensitive substring search across authorized alias/published name/canonical_slug, and sort=newest/context-high-to-low. Search preserves internal spaces/punctuation, rejects outer whitespace/C0/C1 controls and accepts1..256 Unicode code points with locale-independent lowercase matching. Other input lists/sort modes remain rejected. Omission preserves catalog order and full-list behavior without paging defaults.

The complete catalog still validates before enabled model/final-provider IAM, all supplied predicates, stable descending order and paging. Context null/absence follows known zero, ties preserve trusted catalog order and creation uses published alias timestamps. Sorting does not mutate the source catalog. Matching totals/fixed relative continuations retain all eight accepted fields; URL-like literal searches cannot change destination/paging parameters. Each page reevaluates current catalog/IAM. Required audit, captured metadata/order, private errors/events and no inference-side ports remain shared. Published metadata never grants routing authority or certifies live feature/provider freshness.

Red evidence: 54 initial public cases had25 expected failures for newly valid queries and29 invariant passes; actual installed SDK socket cases had8 expected failures and5 existing invalid-syntax passes. The independent source projection/integrity suite had12 expected failures and36 passes because the old pin/projector ignored new selections. Green evidence: all56 new public cases,13 actual SDK cases and48 expanded source projection cases pass in full check. Actual SDK exploration exercises23 requests (13 successful,10 denied), including complete terminal iteration, scalar fields, OpenAI basic aliases and current model/provider Deny. Public cases cover both route kinds, Unicode/code-point boundaries, literal punctuation/URL separators, stable ties/known zero/null/missing metadata, full501 lists, all-field continuation, auth first, implicit/model/provider Deny, disabled aliases, whole-catalog malformed records, catalog/audit/query-audit failure and audit-time mutation.

Separate model-query pin version2 selects eight complete official parameter objects. Removing input_modalities/q/sort reproduces the reviewed version1 canonical digest; the version30 chat pin is byte-identical. Preserve the full official sort enum/open-values extension without claiming every value at runtime or inventing local query bounds in source schemas. Fresh canonical source SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; query projection SHA-256 f1a927b999855356c0507a31a3236deea64a6a7f3e1ca77b433cb5bf89e542d9, retrieved2026-10-06. Existing offline/live commands check both pins; fresh compatibility:drift passes. Full npm run check passes5,229 tests with one existing PostgreSQL skip, strict types/lint/planning/contracts/fixture checks and offline integrity.

Material limits: input singleton/search algorithm/tie rules are explicit local subsets; metadata may be stale/model-level and does not prove live endpoint capability. Policy/catalog changes can repeat/skip offset pages. Multi-values, fuzzy/ranked/locale search, pricing/performance/benchmark sorts, remaining filters, metadata provisioning, full instance/reference/response validation and complete external-client #116 remain open. #7 remains unresolved. No migration or provider/chat-schema change.


Full npm run check passes strict types, lint, 5229 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
