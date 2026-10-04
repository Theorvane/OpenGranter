# Chat probability structural schema guard

## Issue and problem

Issue: [#422](https://github.com/Theorvane/OpenGranter/issues/422), follows nonstream #420/#421 under #116. Selected version-19 source fields omit logprobs/top_logprobs and referenced probability definitions, leaving implemented API structures unguarded when parent references stay unchanged. Fresh official retrieval matches every existing selected structure.

## Scope and expected behavior

Version 20 selects exactly 25 request fields and five success-response definitions: add logprobs/top_logprobs and whole ChatTokenLogprobs/ChatTokenLogprob. Keep all 14 request/history, five stream, three usage, eight reasoning and message/history maps unchanged. Track nullable types, references, required lists, inline alternative fields, integer byte items, format, constraints, defaults and extensions. Reject absent/malformed source containers and stale/rehashed invalid exact maps; ignore editorial annotations without hiding annotation-named properties or literal data. Preserve official structures rather than adding runtime numeric/dependency bounds absent from the OpenAPI.

No runtime, provider, IAM, secrets, accounting, SDK dependency or workflow policy change. This guard does not enable streaming/native probabilities, validate instances or guarantee model support. Full #116 and unresolved #7 remain open.

## Design

Extend the existing fixed selections/envelope version only; refresh the pin from a reviewed fresh [official OpenAPI](https://openrouter.ai/openapi.json), retaining canonical source/projection SHA-256 provenance. Existing selected projection equality is checked before expansion. Repository grilling delegated schema/stream facts; no new domain term or costly ADR is needed. Runtime 0..20/true dependency/byte range/local limits remain in the [nonstream contract](../../contracts/nonstream-logprobs.md); the source has nullable boolean/integer controls without machine bounds and no response probability sign constraint.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [schema contract](../../contracts/openrouter-schema-drift.md), and [slice contract](../../contracts/logprob-schema.md). Keep prior plans historical.

## TDD plan

Write public projection/comparison/pin validation tests before checker changes: exact nullable controls and whole referenced token/group structures must be selected; changing nested bytes/alternatives/content/refusal/required/default/extension data must cause drift with unchanged parent references. Expected red: selected shapes absent and changed nested definitions ignored by v19. Cover editorial equivalence, literal annotation-key preservation, malformed source shapes/fields/maps, old versions and rehashed missing/extra maps. Existing fixed-host, body/time/redirect and CLI privacy cases remain active.

Smallest change adds two field names, two response names and version 20, then a reviewed provenance refresh. Run npm run format, focused source drift tests, explicit fresh-source equality and npm run check; report red/green evidence.

## Delivery

Issue and branch precede plan/tests/code. Link English plan/contract, exact source/projection digests and risks in PR. sjungwon03-ai reviews exact head; both exact-head CI checks precede sjungwon03 squash merge and clean main. A mismatched source is a review signal, never an automatic runtime/pin update. Rollback returns the old guard/pin together. Runtime subset, complete client conformance and other unselected definitions remain open.

## Reviewed provenance

Fresh official retrieval on 2026-10-05 retains canonical source SHA-256 b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5. The version-20 projection SHA-256 is 08b4cca26b19bb4aadde75cc0e1f5ef53707fb08c5c0ba17890a10e48c8a92ea. Removing exactly the two new request fields and two response definitions reproduces the previous version-19 projection byte-for-byte under canonical encoding; every other selected structure is unchanged.

## Verification evidence

Implemented nonstream probability controls and responses were outside the selected source guard. Version 20 now selects exactly logprobs/top_logprobs and whole ChatTokenLogprobs/ChatTokenLogprob, including nullable content/refusal groups, required token/alternative scalars and inline byte/alternative definitions. Nested structural changes cause drift even when ChatChoice/ChatStreamChoice references stay unchanged.

The fixed projection grows from 23 to 25 fields and from three to five response definitions. All 14 request/history definitions, five stream definitions, three usage definitions, eight reasoning definitions and existing message/history maps remain identical. Removing just the two added fields and two added response definitions reproduces the prior canonical projection exactly. Fresh official retrieval on 2026-10-05 retains canonical source SHA-256 b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5; new projection SHA-256 08b4cca26b19bb4aadde75cc0e1f5ef53707fb08c5c0ba17890a10e48c8a92ea.

TDD: 28 new public projection/comparison/pin cases produced 27 expected failures and one passing editorial-equivalence boundary before implementation. Green focused source conformance passes 142 cases, retaining prior fixed-host/time/body/redirect/CLI privacy coverage. New cases cover exact shapes, nullable/type/ref/reference/format/required/default/constraint/extension drift, inline alternatives, editorial equivalence, annotation-named literal data, malformed/missing selected source targets and rehashed invalid/stale pins. Updated old assertions retain every existing target; no tests are deleted.

No runtime/provider/secret/IAM/usage/audit behavior, dependency, migration or workflow authority change. Official controls encode no machine-readable 0..20/true dependency, and bytes have no encoded byte range; those remain separate local runtime checks, never fabricated source constraints. This is selected structural drift coverage, not JSON instance/model/client certification. Streaming/native probabilities, additional unselected schemas, full #116 and unresolved #7 remain open. Current compatibility documents remove the completed source-selection gap; prior delivery plans remain historical.


Full npm run check passes strict types, lint, 2980 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
