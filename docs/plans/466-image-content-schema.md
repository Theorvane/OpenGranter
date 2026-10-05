# Image Content Schema Drift Guard

## Issue and problem

- Issue: #466; follow-up to #464 and compatibility tracking #116.
- Image requests now accept a bounded inline image subset, but the chat schema guard does not select the transitive `ChatContentItems` and `ChatContentImage` targets. Nested URL/detail and union changes can escape comparison.
- The fresh official source defines six content variants and an image detail enum including `original`; these are upstream schema facts, not new runtime requirements.

## Scope and expected behavior

- Select the complete two definitions in version 31 of the chat pin (24 request/history targets), preserving all prior selections and both model discovery pins.
- Detect nested properties, required lists, enums, references, discriminator mappings and extensions; ignore editorial annotations. Reject stale, missing, malformed or incorrectly rehashed pins safely.
- Runtime image validation, IAM, secrets, limits, usage and audit behavior remain as delivered in #464. Remote URLs, `original`, richer parts, native provider image mappings and cache-marked images remain outside the runtime subset.
- Source validation uses the existing fixed official URL, bounded fetch and three-pin CLI; it performs no inference requests and writes no pins automatically.

## Design

- Extend the existing exact request/history target map and regenerate only the reviewed chat projection from a fresh source. Removing both additions must reproduce the version-30 digest.
- Preserve the complete union's references and discriminator strings without recursively selecting audio/video/file targets. Automatic reference closure would broaden the independently reviewed guard scope.
- No new domain decision or ADR is needed. #7 and the wider #116 release gate remain unresolved.
- Update PRD, architecture, acceptance, compatibility, the inline-image contract and the new image-content-schema contract.

## TDD plan

- Add an independent official-shape fixture and mutate image URL constraints; first confirm the existing comparison incorrectly reports no drift.
- Cover exact shapes, nested detail/URL/required changes, content union mappings, annotations versus literal values, malformed source targets, exact pin maps, stale version 30, and preservation of version-30 and older reviewed digests.
- Add only the two fixed definition names and advance the pin version, then run the focused schema and CLI tests.
- Run `npm run format`, `npm run check`, and a fresh live three-pin comparison.

## Delivery

- Issue and branch, plan, red test, minimal guard/pin update, green tests, docs, full checks, PR, exact-head review and CI, then authorized squash merge.
- Risks: selected schema coverage does not certify image bytes, external image clients or full multimodal support. Other rich target bodies remain unselected. Rollback requires reverting the guard and pin together.
- Report exact red/green evidence, source/projection hashes, unchanged discovery pins and material limitations in the PR.

## Verification evidence

Image inputs added in #464 lacked transitive schema coverage: changes to the nested image URL/detail object and content union escaped the existing comparison. Version 31 selects the complete official ChatContentImage and ChatContentItems definitions, giving exactly 24 request/history targets and the same 34 request fields. The two discovery pins remain byte-identical. Removing both additions reproduces the reviewed version-30 projection digest; earlier version-28/29 preservation tests remain green.

Red: node --test --test-name-pattern='image URL structural constraint drift' test/openrouter-schema-drift.test.ts failed once as expected: changing the source URL type to integer still returned true instead of detecting drift. Green: node --test test/openrouter-schema-drift.test.ts test/logprob-schema-drift.test.ts test/model-query-schema-cli.test.ts passes 319 tests. The independent fixture covers exact upstream shapes, URL/detail/container/union drift, editorial annotations versus literal data, unselected rich targets, missing/non-object selections and stale/rehashed invalid pins. Controlled CLI cases verify chat-only image/union drift, no download for stale pins, no success output for malformed image sources and unchanged pin bytes.

Fresh official source SHA256: 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458. New chat projection SHA256: 0bf32d91e86d7c0cbb41042133f781ce3b6bb299bef2396a41a8a9d920a069e2. npm run compatibility:drift passes all three selected subsets against one bounded fixed-host credential-free retrieval; npm run format and git diff --check pass.

This is a source drift guard, not a request-instance validator or broader multimodal runtime implementation. Preserve the #464 bounded inline image behavior and existing IAM, secrets, audit, usage and provider restrictions. Remote URLs, original/unknown detail values, audio/video/file target bodies, native image mappings and live per-model certification remain outside this change. Full #116 and unresolved #7 stay open.


Full npm run check passes strict types, lint, 5415 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
