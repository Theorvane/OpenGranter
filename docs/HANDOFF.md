# OpenGranter agent handoff

## Current continuation checkpoint (#570)

PR #569 received GitHub approval on 9752216b5a47977705d2a890c513ec89bb4f473e with all seven checks successful, including host and bridge smoke, and merged as d7ba0554b542be78924a82b5c9206b09c1b18758. Issue #568 is closed. Issue #570 adds the optional system-service packaging from plan #566; see [plan](plans/570-systemd-service.md) and [guide](guides/systemd.md). Require exact-head full CI and GitHub approval. Local systemd and Docker execution are unavailable; static unit verification is not installed-host acceptance. #561 remains untouched; full #116 and unresolved #7 remain open.

## Previous continuation checkpoint (#568)

PR #567 received GitHub approval on f30cd50e9902b94a5a81ccd61c17189c8535f730 with all five checks successful and merged as 6798ed0e729c5cedbd326747c5d4c1498b08a979. Issue #566 is closed. Issue #568 closes the documented bridge networking CI gap while retaining host-mode coverage. Read [plan](plans/568-container-bridge-smoke.md). Require fresh exact-head CI and GitHub approval before merge. Docker is unavailable locally. #561 remains separately owned; full #116 and unresolved #7 remain open.

## Previous continuation checkpoint (#566)

PR #565 was approved at ef66dc730f253f15a3d710caf9e7ebafe456498d with all three checks successful and merged as 78ef184f0bbb87d7156ab7b484f54a19f3df490b. Issue #564 is closed. Issue #566 adds optional non-root container packaging without a permissive bootstrap, new API or production-completeness claim. Read [plan](plans/566-container-packaging.md) and [container guide](guides/container.md). Refresh its exact-head approval and CI before merge. PR #561 was separately open at this checkpoint and was not merged as part of #565. Full #116 and unresolved Jev #7 remain open.

## Previous continuation checkpoint (#558)

PR [#557](https://github.com/Theorvane/OpenGranter/pull/557) received approval on 59791e017c8bb728bfa2a9d34ef78db07a61ed53 with all three checks successful and merged as 491c3e8; issue #556 is closed. Issue [#558](https://github.com/Theorvane/OpenGranter/issues/558), branch feat/558-prestream-errors, adds bounded text/function pre-stream429/503 and retry hints. Read [plan](plans/558-prestream-errors.md) and [error contract](../contracts/openrouter-error-schema.md#pre-stream-observed-status-and-retry-hints-558), then refresh PR/review/CI before assuming merge.

Initial red: 104 expected missing-status/hint failures among 144 cases, 40 passes; minimal consumer/HTTP-adapter changes made all 144 pass. First full validation found 9 existing SDK expectations of the superseded compatible pre-stream mapping; only those expectations changed. Integrated focused regressions passed 711 tests including all 268 new cases and 96 actual SDK cases. Both bases/all adapters/modes, malformed hints, admission, delayed/failed persistence, post-frame metadata isolation, interruption audit and fallback outcomes are covered. Final npm run check passed 8,212 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline source-integrity checks (~244 seconds). Compatible pre-stream JSON keeps observed status; legacy keeps502 and both may receive bounded hints. Already-started SSE stays generic and no new retry eligibility/accounting/schema field is introduced. Six source pins, dependencies and storage are unchanged; broader error/type/date/402, full #116 and unresolved Jev #7 stay open. Earlier checkpoints below are historical.

## Historical continuation checkpoint (#556)

PR [#555](https://github.com/Theorvane/OpenGranter/pull/555) received approval on 205c50019fceedcbc543dd18e827b47b2febc90b with all three checks successful and merged as db2535a; issue #554 is closed. Issue [#556](https://github.com/Theorvane/OpenGranter/issues/556), branch test/556-ai-sdk-image-tools, measures actual pinned inline-PNG/function-result composition. Read [plan](plans/556-ai-sdk-image-tools.md), [contract](../contracts/ai-sdk-client-workflows.md#inline-image-tool-continuations-556) and [reproduction](ai-sdk-conformance.md#inline-image-tool-reproduction-556), then refresh PR/review/CI before assuming merge.

Initial 96 cases passed unchanged production code; expanded continuation auth/implicit/model/provider/limit gates bring the new suite to 160 passing cases. Focused SDK/native/image regressions passed 430 cases. Exact native image/history/correlation, fresh admission, first/second persistence faults, private accounting and actual final-frame withholding are measured. SDK summaries/finish events do not certify server persistence or billed cost. Final npm run check passed 7,944 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline source-integrity checks (~242 seconds). No runtime defect or production red/green claim is made; runtime, dependencies, six source pins and storage remain unchanged. Signed Gemini/richer/remote/live/version/endpoint cases, full #116 and unresolved Jev #7 remain open; earlier checkpoints below are historical.

## Historical continuation checkpoint (#554)

PR [#553](https://github.com/Theorvane/OpenGranter/pull/553) received approval on 984b1ffd6394a1eacacb0d9ad7eb61e68bcf7635 with all three checks successful and merged as c7a2cf5; issue #552 is closed. Issue [#554](https://github.com/Theorvane/OpenGranter/issues/554), branch feat/554-upstream-statuses, adds bounded compatible nonstream upstream 429/503 status projection. Read [plan](plans/554-upstream-statuses.md) and [error contract](../contracts/openrouter-error-schema.md#compatible-observed-upstream-statuses-554), then refresh PR/review/CI before assuming merge.

Only known observed responses with matching category/status are projected after required handoffs. Legacy 502, fixed messages/unmapped metadata, private conservative accounting, fallback and bounded hints remain. Initial red reproduced 16 missing-status failures among 40 cases; a separate defensive red found 2 contradictory no-response metadata cases. Final focused regressions passed 278 tests, including actual SDKs, spoofed metadata, delayed/failed persistence and fallback isolation. Final full validation passed 7,784 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline integrity checks. Streaming, broader error/type/date/402 parity, full #116 and unresolved Jev #7 remain open. Pins, dependencies and storage are unchanged; earlier checkpoints below are historical.

## Historical continuation checkpoint (#552)

PR [#551](https://github.com/Theorvane/OpenGranter/pull/551) received approval on eb544ee2b25da81d031150796bd09b22a922fd65 with all three checks successful and merged as c22b303; issue #550 is closed. Issue [#552](https://github.com/Theorvane/OpenGranter/issues/552), branch test/552-ai-sdk-structured-output, adds actual pinned Output.object conformance. It began independently from approved main fcb40ea and updated onto approved main c22b303 before final validation. Read [plan](plans/552-ai-sdk-structured-output.md), [contract](../contracts/ai-sdk-client-workflows.md#structured-object-workflows-552) and [reproduction](ai-sdk-conformance.md#structured-object-reproduction-552), then refresh PR/review/CI before assuming merge.

All 48 new cases and 258 focused SDK/format regressions pass. The measured client can strip extra properties or resolve an object after a stream persistence error; output/finish events do not certify full schema conformance or server persistence. Actual wire errors/final-frame withholding, admission/private accounting and native schema rejection remain tested. No production code, six pins, dependencies or storage changes. Final full validation on approved main c22b303 passed 7,724 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline integrity checks. Other Output/partial/native/live cases, full #116 and unresolved Jev #7 remain open; earlier checkpoints below are historical.

## Historical continuation checkpoint (#550)

PR [#549](https://github.com/Theorvane/OpenGranter/pull/549) received approval on 2346f1fc16bdb20047a1cf05333c669d38bf385e with all three checks successful and merged as fcb40ea; issue #548 is closed. This branch began independently from approved main 58700b6 and has now been updated onto approved main fcb40ea, preserving both the retry-header implementation and these image probes. Issue [#550](https://github.com/Theorvane/OpenGranter/issues/550), branch test/550-ai-sdk-inline-images, adds actual pinned generateText/streamText inline-PNG conformance. Read [plan](plans/550-ai-sdk-inline-images.md), [contract](../contracts/ai-sdk-client-workflows.md#inline-png-workflows-550) and [reproduction](ai-sdk-conformance.md#inline-png-reproduction-550), then refresh this branch's PR/review/CI before assuming merge.

All 40 new cases and 302 focused actual-client/image/native regressions pass without production changes. Exact native bytes/MIME/order, empty client media-download plans, admission/persistence gates and cancellation/possible-billing/privacy are measured on both bases/all four adapters. Final integrated validation on approved main fcb40ea passed 7,676 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline integrity checks. Production source, six pins, dependencies and storage are unchanged. The broader image-control matrix, image+tool/richer/signed-Google/live workflows, full #116 and unresolved Jev #7 remain open. Earlier checkpoints below are historical.

## Historical continuation checkpoint (#548)

PR [#547](https://github.com/Theorvane/OpenGranter/pull/547) received approval on fd0940206a1cbedadd39c9207373d9353d30bce4 with all three checks successful and merged as 58700b6; issue #546 is closed. Issue [#548](https://github.com/Theorvane/OpenGranter/issues/548), branch feat/548-upstream-retry-hints, adds bounded nonstream Retry-After delivery. Read [plan](plans/548-upstream-retry-hints.md) and [error contract](../contracts/openrouter-error-schema.md#bounded-nonstream-retry-after-548), then refresh PR/review/CI before assuming merge.

Typed integer-seconds hints from registered upstream 429/503 are projected only after required failed-attempt usage and outcome audit, on the existing 502 upstream_failed response. Local/persistence failures, other statuses, success and stale fallback hints remain excluded. Actual OpenAI/OpenRouter/AI SDK sockets cover both bases/all four adapters with retries disabled; hints remain outside audit/ledger/error JSON. Initial red reproduced 64 missing-header failures among 96 cases; focused final regressions passed 218 cases. Final npm run check passed 7,636 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline integrity checks. HTTP dates, streaming hints, precise cause/status parity, full #116 and unresolved Jev #7 remain open. Source pins, dependencies and storage are unchanged; earlier checkpoints below are historical.

## Historical continuation checkpoint (#546)

PR [#545](https://github.com/Theorvane/OpenGranter/pull/545) received approval on ec6375baee680fed09dbe14a41fa7337447d751d with all three checks successful and merged as 33a2a27; issue #543 is closed. Issue [#546](https://github.com/Theorvane/OpenGranter/issues/546), branch test/546-ai-sdk-nonstream-tools, measures actual pinned generateText parallel function/result loops across both bases and all four adapters. Read [plan](plans/546-ai-sdk-nonstream-tools.md), [contract](../contracts/ai-sdk-client-workflows.md#nonstream-parallel-continuations-546) and [reproduction](ai-sdk-conformance.md#nonstream-parallel-tool-reproduction-546), then refresh PR/review/CI before assuming merge.

New probes cover reverse client completion with exact native correlation, fresh continuation provider Deny and admission/required persistence failure before tool delivery. The pinned AI SDK recomputes totalTokens from input/output, while wire and server ledger preserve independent reported totals; do not use client summaries as billed accounting. Production code, six source pins, dependencies and storage remain unchanged. Focused SDK/native regressions passed 280 cases. The final full gate, including the final denial-audit/request-identity/persistence assertions, passed 7,472 tests with one optional external PostgreSQL skip, zero failures/cancellations and all six offline integrity checks. Signed Gemini/richer client paths, full #116 and unresolved Jev #7 remain open. Earlier checkpoints below are historical.

## Historical continuation checkpoint (#543)

PR [#544](https://github.com/Theorvane/OpenGranter/pull/544) received approval on 3c5ee42f1152f9b5c7a5d04873dd2108810ea816 with all three checks successful and merged as dbed817; issue #542 is closed. Issue [#543](https://github.com/Theorvane/OpenGranter/issues/543), branch test/543-model-response-drift, reconciles the previously observed official model-response nullable-marker drift. Read [plan](plans/543-model-response-drift.md) and [contract](../contracts/model-response-schema.md#reviewed-version4-checkpoint-543), then refresh PR/review/CI before assuming merge.

Fresh captured source confirms exactly seven removed markers with type arrays and all other selected structures unchanged. Response pin/validator v4 retain stale-version rejection and full historical digest proofs; other five pin bytes, complete runtime source, dependencies and migrations remain unchanged. Focused schema/CLI regressions passed 711 cases. Full validation passed 7,392 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live comparisons passing. The drift observed in #542 is reconciled in this branch; refresh the PR status before treating it as merged. No model capability or local null semantics change. Full #116 and unresolved Jev #7 remain open; earlier checkpoints are historical.


## Historical continuation checkpoint (#542)

PR [#541](https://github.com/Theorvane/OpenGranter/pull/541) received approval on cc32c410e924e9e55cb1a0016f33c552f80673c6 with all three checks successful and merged as bf3d3d4; issue #540 is closed. Issue [#542](https://github.com/Theorvane/OpenGranter/issues/542), branch fix/542-legacy-fingerprints, makes unknown nonstream fingerprints null on both bases. Read [plan](plans/542-legacy-fingerprints.md), [contract](../contracts/compatible-completion-fingerprints.md#both-base-unknown-fingerprint-projection-542) and [official SDK tools](../contracts/official-sdk-tools.md), then refresh PR/review/CI before assuming merge.

The shared post-persistence response projector removes its obsolete format parameter and preserves reported metadata/frozen originals. Actual official SDK text and two-request function/result workflows now accept omitted upstream fingerprints on /v1 as well as /api/v1. Legacy property presence intentionally changes; error formats, streams, numeric usage omission and accounting stay unchanged. Focused regressions passed 915 cases and the follow-up integration/core selection passed 122. The final full gate passed 7,373 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline pin checks passing. Live comparison passes five selections; model-response nullable-marker drift is separately recorded in #543 and must be reviewed before claiming live equality. No pins, dependencies, migrations or operational schemas change. Full #116 and unresolved Jev #7 remain open; earlier checkpoints are historical.


## Historical continuation checkpoint (#540)

PR [#539](https://github.com/Theorvane/OpenGranter/pull/539) received approval on 6925f6d3e0a2dbe7f0deb528ad50c589826e109e with all three checks successful and merged as 3dcd2c6; issue #538 is closed. Issue [#540](https://github.com/Theorvane/OpenGranter/issues/540), branch fix/540-legacy-usage, applies the existing complete-counter usage projection to /v1 nonstream chat responses. Read [plan](plans/540-legacy-usage.md) and [contract](../contracts/compatible-completion-usage.md#both-base-numeric-usage-omission-540), then refresh PR/review/CI state before assuming merge.

The actual AI SDK legacy sparse-Google parser failure is resolved without inferred totals: both bases omit incomplete usage, preserving partial/missing/invalid ledger records and complete counters/details. Legacy fingerprint omission and error formats, opaque results and streams remain unchanged. Protected usage history provides partial data under existing permissions. Focused regressions passed 1,542 cases; the follow-up SDK/core selection passed 91. The final full gate passed 7,367 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live schema checks passing. No pins, dependencies, migrations or operational schemas change. Full #116 and unresolved Jev #7 remain open; earlier checkpoints are historical.


## Historical continuation checkpoint (#538)

PR [#537](https://github.com/Theorvane/OpenGranter/pull/537) received approval on 7f68a056f3fdf22d6921997cb5d69164974bc1c4 with all three checks successful and merged as 54f548a; issue #536 is closed. Issue [#538](https://github.com/Theorvane/OpenGranter/issues/538), branch feat/538-ai-sdk-workflows, adds real OpenRouter AI SDK text/tool-loop conformance and fixes correlated optional tool-result names. Read [plan](plans/538-ai-sdk-workflows.md), [contract](../contracts/ai-sdk-client-workflows.md) and [reproduction](ai-sdk-conformance.md), then refresh PR/review/CI state before assuming merge.

The shared history snapshot validates name against its pending call and drops the redundant hint before unchanged native/delegated transport. Pinned development-only provider/AI SDK/zod versions are 3.1.0/7.0.153/4.6.6. Client finish-step/zero defaults are not server persistence/billing evidence; sparse legacy Google usage remains a measured client gap. Focused regressions passed 372 cases; the full gate passed 7,363 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live schema checks passing. Existing six pins, production dependencies, migrations and ledger schemas remain unchanged. Full #116 and unresolved Jev #7 stay open; earlier checkpoints are historical.


## Historical continuation checkpoint (#536)

PR [#535](https://github.com/Theorvane/OpenGranter/pull/535) received approval on9715665415e0a6162eb70ede052810d667e67f71 with all three checks successful. Following explicit user merge authorization it merged as6e4b6ca; issue #534 is closed. Issue [#536](https://github.com/Theorvane/OpenGranter/issues/536), branch feat/536-anthropic-served-tiers, preserves actually reported native Anthropic service tiers in compatible responses. Read [plan](plans/536-anthropic-served-tiers.md) and [contract](../contracts/service-tier-requests.md#reported-anthropic-response-tiers-536), then refresh the linked PR/review/CI state before assuming merge.

JSON and both native SSE consumers capture exact string/null/absence separately from counters; stream metadata is withheld until successful final persistence. A separately reproduced shared SSE encoder bug now retains tier-only final frames without invented token usage. Request mappings, model/provider IAM, limits, cache counters, six pins, dependencies and operational schemas remain unchanged. Focused native/SDK/encoder/cache regressions passed 515 cases. The full gate passed 7,294 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live schema comparisons passing. Full #116 and unresolved Jev #7 remain open. Earlier checkpoints below are historical.


## Historical continuation checkpoint (#534)

PR [#533](https://github.com/Theorvane/OpenGranter/pull/533) received approval on c6fcba9482930d3c64405f413e4ac4857e1b03ad with all three checks successful and merged as78d5d29; issue #532 is closed. Issue [#534](https://github.com/Theorvane/OpenGranter/issues/534), branch feat/534-anthropic-service-tiers, adds direct Anthropic auto/default request tiers mapped to native auto/standard_only. Read [plan](plans/534-anthropic-service-tiers.md) and [contract](../contracts/service-tier-requests.md#direct-anthropic-capacity-mapping-534), then refresh the linked PR/review/CI state before assuming merge.

The common direct guard/body preparation changes; prior provider subsets, approved destination authority, caps/version headers, six pins, dependencies and storage/accounting schemas remain unchanged. SDK/native JSON/SSE regressions passed410 focused cases. The full gate passed7,249 with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live source comparisons passing. Do not infer served tier from request controls: native served-tier response projection, expanded delegated tier authorization, full #116 and Jev #7 remain open. Earlier checkpoints below are historical.


## Historical continuation checkpoint (#532)

PR [#531](https://github.com/Theorvane/OpenGranter/pull/531) received approval on4ad5e9392db4362b0ced2bfc59e1e416b6133030 with all three checks successful and merged as6ce0f33; issue #530 is closed. Issue [#532](https://github.com/Theorvane/OpenGranter/issues/532), branch feat/532-delegated-cache-ttl, extends explicit root cache options with12h for delegated OpenRouter. Read [plan](plans/532-delegated-cache-ttl.md) and [contract](../contracts/prompt-cache-options.md#delegated-request-ttl12h-532), then refresh PR/review/CI status before assuming merge.

The shared snapshot admits12h but the common direct transport rejects it before credentials in all direct modes. Preserve the official Chat/Responses scope difference: managed OpenAI root TTL remains30m. Typed OpenRouter SDK root12h transport works, while its per-block TTL stripping limitation remains. Focused cache/SDK suites passed1,244 cases; the full gate passed7,213 with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live source comparisons passing. All six source pins, dependencies, migrations and operational accounting/event schemas are unchanged. Full #116 and unresolved Jev #7 remain open; prior checkpoints below are historical.


## Historical continuation checkpoint (#530)

PR [#529](https://github.com/Theorvane/OpenGranter/pull/529) received approval on da14b765aaa5d90ebddd9c4c220c31032a85847d with all three checks successful and merged as db31938; issue #528 is closed. Six source guards are now in approved main. Issue [#530](https://github.com/Theorvane/OpenGranter/issues/530), branch feat/530-breakpoint-ttl, adds optional 30m/12h TTL to existing text breakpoints. Read [plan](plans/530-breakpoint-ttl.md) and [contract](../contracts/prompt-cache-breakpoints.md#optional-text-breakpoint-ttl-530), then refresh its PR/review/CI state before assuming merge.

Only the shared immutable marker snapshot changes in production; existing pins, dependencies, migrations, IAM/audit/accounting controls and native unsupported-marker boundaries are preserved. Raw HTTP and OpenAI SDK retain TTL, while pinned OpenRouter1.4.18 strips it before HTTP; do not claim typed TTL support for that client. Focused cache/SDK suites passed1,198 cases; the full gate passed7,167 cases with one optional external PostgreSQL skip, zero failures/cancellations, and all six offline/live source checks passing. No live inference, credential or cache cost/retention guarantee was used. Full #116 and unresolved Jev #7 remain open. Earlier checkpoints below are historical.


## Historical continuation checkpoint (#528)

PR [#525](https://github.com/Theorvane/OpenGranter/pull/525) merged the user collection runtime as 87512ac; issue #524 is closed. PR [#527](https://github.com/Theorvane/OpenGranter/pull/527) was approved on dd29d2fbdfcb4f53b0aff099fe37516cce6f0ed4 with all three checks successful and merged as 1704969; issue #526 is closed. This independently refreshed the request/query/response pins to33/5/3.

Issue [#528](https://github.com/Theorvane/OpenGranter/issues/528), branch test/528-user-model-schema, adds the sixth bounded source guard for the user-list operation, its explicit bearer security, four query objects and root/array/item definitions. Read [plan](plans/528-user-model-schema.md) and [contract](../contracts/user-model-schema.md); refresh the linked PR state rather than assuming merge. The prior five pin bytes and all runtime code remain unchanged. The branch is rebased onto approved main 1704969, preserving both reviewed source changes and sixth-guard cases; integrated focused tests passed446 cases and the full gate passed7,095 cases with one optional external PostgreSQL skip, zero failures/cancellations and all six offline/live schema comparisons passing. Full #116, rich metadata provisioning, unsupported query values, upstream preferences/privacy/regions and Jev #7 remain open. Earlier checkpoints below are historical.

## Historical reviewed-source checkpoint (2026-10-25, #526)

PR #525 was approved on a66b98155e38e145821ab2e39dc863d5322cc340 with all checks successful and merged as87512ac; issue #524 is closed. Fresh official comparison found drift in three existing selections, so issue [#526](https://github.com/Theorvane/OpenGranter/issues/526) and branch test/526-reviewed-source-drift reconcile request/query/response pins to33/5/3 before a sixth user-operation guard is added. The only selected changes are optional breakpoint TTL, removal of offset nullable:false and restoration of seven nullable:true response markers. Runtime, five-result CLI scope and count/single pin bytes remain unchanged. Read the [plan](plans/526-reviewed-source-drift.md) and refresh PR/review/CI status before assuming merge. Nine focused schema suites passed 613 cases; full validation passed 7,016 tests with one optional PostgreSQL skip and zero failures/cancellations. Fresh live and offline comparisons passed all five selections. Broad #116, user-operation structural coverage and unresolved #7 remain open.

## Continuation checkpoint (2026-10-25)

PR #523 was approved on cb9529573337c1b7d176e0dd7d40e3a06c81ffd1 with all three checks successful and merged as 3eac26f; issue #522 is closed. Issue [#524](https://github.com/Theorvane/OpenGranter/issues/524) and branch feat/524-user-model-discovery add the proxy-IAM OpenRouter user-list collection, text defaults, fixed user-path pagination and explicit bearer/identity tests. Read its [plan](plans/524-user-model-discovery.md) and [contract](../contracts/user-model-discovery.md), then refresh PR/review/CI status before assuming merge. Compatible user is now reserved over OpenAI retrieval; /v1 can still retrieve a user alias. Rich metadata, upstream account preferences/privacy/regions, this new operation's source guard and full #116 remain unresolved gates; #7 is unchanged. Local full validation passed 6,998 tests with one optional external PostgreSQL skip and zero failures/cancellations; all five offline schema checks passed. Older checkpoints below are historical.

## Continuation checkpoint (2026-10-24)

PR #521 merged this guide as 1a9d019; no new remote work was present when continuation began. Issue [#522](https://github.com/Theorvane/OpenGranter/issues/522) and branch feat/522-openai-model-retrieval now track a separate OpenAI models.retrieve extension using exact encoded alias parameters and bare listing projections on both bases. The compatible count path retains precedence; OpenRouter's singular wrapped rich lookup is unchanged. Read its [plan](plans/522-openai-model-retrieval.md) and [contract](../contracts/openai-model-retrieval.md), then refresh the linked issue's PR/review/CI state before assuming it is merged. Local full validation passed 6,977 tests with one optional PostgreSQL skip, zero failures/cancellations and all five offline schema checks, using the documented CPU-affinity gate. The older delivery/workspace snapshot below remains historical; temporary worktrees may have disappeared. Broad #116 and unresolved #7 remain open.

Snapshot: 2026-10-18, after PR #519 merged at 13:13 UTC. This is a continuation guide, not a release certification. Refresh GitHub and Git before acting on its status tables.

## Start here

1. Read [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). CLAUDE.md is a symbolic link to AGENTS.md; preserve it.
2. Read [product requirements](PRD.md), [acceptance scenarios](acceptance.md), [compatibility inventory](openrouter-compatibility.md), [coding rules](coding.md) and the [domain glossary](../CONTEXT.md). Consult [architecture](architecture.md), [routing](routing.md) and the relevant contract/issue plan before changing that behavior.
3. Refresh repository and GitHub state using the commands below. Inspect uncommitted work and worktree ownership before switching or deleting anything.
4. Finish any current review feedback before selecting another implementation issue. Use the current compatibility inventory and executable cases to identify the next bounded gap.

Repository documents contain historical checkpoints. The roadmap is a broad sequence, and an old unchecked issue checklist or earlier exclusion paragraph does not establish that a feature is still absent. Read the latest relevant sections, plans, contracts and implementation together. Conversely, a passing bounded test or structural pin does not prove complete compatibility.

## Product direction and fixed boundaries

OpenGranter is a single-organization TypeScript LLM gateway. Developers and internal services receive OpenGranter proxy tokens; provider credentials stay server-side behind secret references. Internal IAM policies control the requested model and final inference provider, with default Deny and explicit Deny precedence. This is an internal IAM-style engine, not AWS IAM integration.

Two route kinds share authentication, IAM, limits, required private audit and per-attempt usage:

- Delegated: OpenRouter chooses only within the server-approved, evaluated destination scope.
- Managed: OpenGranter selects among registered direct OpenAI, Anthropic and Google Gemini routes. Optional Jev selection operates within eligible candidates; the actual Jev integration still has unresolved product decisions.

Fallback stays within one route kind. Caller input, model metadata links, canonical slugs and alias targets must never become arbitrary upstream destinations or widen permissions. Distinguish missing usage, estimated prices, provider-reported cost and possible duplicate billing. Prompt/response content and credentials must not enter operational records or client errors; protected content-audit retention requires its own explicitly enabled policy.

External tools must eventually be able to use the compatible API end to end. Current clients use a configured gateway base such as https://gateway.example/api/v1 and an OpenGranter proxy token. Legacy /v1 remains available, with documented differences. Do not claim complete OpenRouter compatibility.

## Verified delivery checkpoint

Main commit at this snapshot: c7cbbbe15c2c6ae3e79d2c1d706c87c7d571fd95.

| PR | State at snapshot | Delivered behavior and reading |
| --- | --- | --- |
| [#511](https://github.com/Theorvane/OpenGranter/pull/511) | Merged | Reviewed official source drift; request pin v32 and model-response pin v2. [Plan](plans/509-reviewed-schema-drift.md). Structural changes do not enable new runtime fields. |
| [#513](https://github.com/Theorvane/OpenGranter/pull/513) | Merged | Exact advertised prompt/output price ranges, USD per million query units against per-token decimal strings; query pin v4. [Plan](plans/512-model-price-ranges.md), [contract](../contracts/model-price-ranges.md). |
| [#516](https://github.com/Theorvane/OpenGranter/pull/516) | Merged | GET /api/v1/model/{author}/{slug} for exact published rich aliases. Current model/provider IAM; private 404 for unknown/inaccessible targets; no metadata-target redirects. [Plan](plans/514-single-model-discovery.md), [contract](../contracts/single-model-discovery.md). |
| [#517](https://github.com/Theorvane/OpenGranter/pull/517) | Merged as 4f3d7df | Fifth structural guard for the single-model operation, required author/slug parameters and ModelResponse/Model. [Plan](plans/515-single-model-schema.md), [contract](../contracts/single-model-schema.md). Issue #515 is closed. |
| [#519](https://github.com/Theorvane/OpenGranter/pull/519) | Merged as c7cbbbe | Consistent no-store on model listing/count/lookup responses, errors and Node fallbacks. [Plan](plans/518-discovery-no-store.md), [contract](../contracts/model-discovery-cache.md). Issue #518 is closed. |

PR #519 was reapproved on exact head d5ce2cef7cada53184362f39b8279a06767e25e5; both check jobs and metadata CI succeeded before merge. An earlier approval on f0b60de was not used as approval of the rebased head. No implementation PR remains open at this snapshot. Issue [#520](https://github.com/Theorvane/OpenGranter/issues/520) tracks this documentation handoff; refresh its PR status separately.

The current schema CLI monitors six selected structural projections: chat request/response fragments, model-list queries, model-list response metadata, model count, single model and user model (including explicit operation security). Referenced metadata coverage is shared between the model-response and single-model guards. These are integrity/drift checks, not full graph traversal, runtime instance validation or live capability certification. Do not refresh provenance blindly when live drift fails.

## Remaining work and next decisions

| Tracking item | What the next agent should do |
| --- | --- |
| [#116: complete OpenRouter external-client compatibility](https://github.com/Theorvane/OpenGranter/issues/116) | Keep open. Reconcile the current inventory and conformance tests, then choose one actual missing client workflow or API behavior with explicit acceptance criteria. Use a new issue and branch for each implementation. |
| [#7: Jev-assisted managed routing](https://github.com/Theorvane/OpenGranter/issues/7) | Keep open. Existing candidate authorization/selection coordinators do not resolve the exact Jev product/API, decision-failure policy or permitted request data. Read the issue and planning decisions before any external integration; do not invent them. |
| Management and operational readiness | Separate implemented SSO/token-management runtime boundaries from incomplete binding/key provisioning, broader management UI, deployment configuration and operational procedures. Consult the relevant contracts before selecting work; this handoff does not settle those decisions. |

Examples of remaining compatibility areas recorded in the inventory include broader endpoint/query coverage, metadata publication/refresh, precise upstream errors and retry hints, remaining native/rich/tool mappings, full instance/reference conformance and complete named-client workflows. This is a gap inventory, not an ordered implementation commitment. Check the current code before creating duplicate work.

Model query age/author/architecture semantics and new client routing controls need particular care: locally published aliases or timestamps are not automatically upstream model authors/creation dates, and caller controls must only narrow fully evaluated approved destinations. Do not add a superficially compatible field whose actual meaning is unresolved.

For a plan interview, read [grill-with-docs](../skills/grill-with-docs/SKILL.md), [grilling](../skills/grilling/SKILL.md) and [domain-modeling](../skills/domain-modeling/SKILL.md). Ask the user only for unresolved decisions; inspect facts yourself. Keep agreed domain terms in CONTEXT.md and reserve ADRs for consequential trade-offs. User-facing conversation is Korean; repository documents, issues and PR bodies are English.

## Implementation map

| Area | Entry points |
| --- | --- |
| Shared HTTP and discovery | [chat-handler.ts](../src/gateway/chat-handler.ts), [model-list-query.ts](../src/gateway/model-list-query.ts), [model-discovery-metadata.ts](../src/gateway/model-discovery-metadata.ts), [single-model-query.ts](../src/gateway/single-model-query.ts) |
| Exact advertised price comparison | [model-price-order.ts](../src/gateway/model-price-order.ts). Preserve exact decimals; do not substitute floating-point billed-money arithmetic. |
| Socket and cache boundary | [node-request-server.ts](../src/gateway/node-request-server.ts), [model-discovery-path.ts](../src/gateway/model-discovery-path.ts) |
| Policy and routing | [evaluate.ts](../src/policy/evaluate.ts), [authorize-candidates.ts](../src/routing/authorize-candidates.ts), [invoke-jev-managed-route.ts](../src/routing/invoke-jev-managed-route.ts), [invoke-delegated-route.ts](../src/routing/invoke-delegated-route.ts) |
| Native and delegated adapters | [direct-chat.ts](../src/providers/direct-chat.ts), [openrouter-chat.ts](../src/providers/openrouter-chat.ts); adjacent provider modules and src/streaming handle controlled streams/functions. |
| Runtime and SSO management | [postgres-gateway-runtime.ts](../src/gateway/postgres-gateway-runtime.ts), [postgres-sso-management-http.ts](../src/gateway/postgres-sso-management-http.ts), [runtime contract](../contracts/sso-management-runtime.md). The SSO management listener is opt-in and separate from inference listeners. |
| Storage and audit | src/storage, src/audit and src/usage. [Audit projector](../src/audit/postgres-gateway-audit.ts) is an allowlist; keep new event data content-free and principal-scoped. |
| Schema conformance | [check-openrouter-schema.ts](../scripts/check-openrouter-schema.ts), scripts/openrouter-*-schema.ts and contracts/openrouter-*-schema.json. Read their contracts and independent fixture tests. |
| External client reproduction | [OpenCode conformance](opencode-conformance.md), [conformance script](../scripts/conformance-opencode.ts), installed-SDK tests in test/sdk-*.test.ts. |

Recent focused regressions: [model-discovery-cache.test.ts](../test/model-discovery-cache.test.ts), [node-discovery-cache.test.ts](../test/node-discovery-cache.test.ts), [single-model-discovery.test.ts](../test/single-model-discovery.test.ts), [single-model-schema.test.ts](../test/single-model-schema.test.ts). Reuse [the discovery fixture](../test/model-discovery-filters-fixture.ts) where it fits; it fails if discovery reaches inference, secrets, limits or accounting.

## Validation and reproduction

Use Node.js 22.14 or newer within the repository's engine requirement and npm with the committed lockfile. Run npm ci when dependencies need installation. The current WSL session uses /home/ubuntu/.local/bin for Node/npm; that path is machine-specific, not a deployment requirement. package.json defines the authoritative commands.

```sh
npm run check
npm run compatibility:check
# Optional network comparison; no inference and no automatic pin updates:
npm run compatibility:drift
```

The last integrated production gate, recorded in plan #518, completed 6,960 cases: 6,959 passed, one optional external PostgreSQL skip, zero failures/cancellations. Types, lint, planning/link/contract/fixture-secret checks and all five offline pin checks passed. GitHub CI also passed the exact reviewed PR #519 head.

An earlier integrated run had three existing 15-second PostgreSQL shutdown cancellations and zero assertion failures under host contention. The unchanged postgres-gateway-runtime and postgres-sso-management-runtime files passed all 24 cases in isolation. A full retry passed using CPU affinity to reduce Node worker parallelism:

```sh
taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS npm run check
```

This Linux command requires those CPUs to be available. It changes scheduling only; no test, deadline or assertion was disabled. Do not hide failures with warning suppression or increase timeouts merely to get a green run. The exact historical command additionally set PATH to the local Node directory; see the plan for that session-specific invocation.

Without OPENGRANTER_TEST_DATABASE_URL, the optional external PostgreSQL driver test skips while embedded database tests still run. For that integration use only a disposable test database, following [README](../README.md#postgresql-integration-checks). Never point the integration tests at production data. Named OpenCode probes have separate prerequisites in their guide; their pinned versions and mocked upstreams do not certify live providers or all client versions.

Local optional logs from the last implementation are /tmp/opengranter-518-red.log, /tmp/opengranter-518-focused.log, /tmp/opengranter-518-runtime-recheck.log and /tmp/opengranter-518-integrated-retry.log. They are not committed, may disappear and are not prerequisites for continuing. The tracked plan, tests and GitHub checks preserve the reviewable evidence.

## Contributor and review procedure

- Issue first, then a fresh branch from current main named <type>/<issue-number>-<topic>. Do not reuse a merged branch. Before implementation create docs/plans/<issue>-<topic>.md from the [template](plans/TEMPLATE.md).
- Every production change uses meaningful red/green TDD through public boundaries. Cover authorization/authentication/secret/accounting success, denial and failure paths. Record the actual failure before the implementation, then focused and full-gate results.
- Use sjungwon03 <sjungwon03@gmail.com> as both author and committer. The user explicitly authorized their human DCO for this work. Include Assisted-by: Codex and Signed-off-by: sjungwon03 <sjungwon03@gmail.com>; do not sign as an agent.
- Open ready PRs, link their plan and issue, and report material limitations. Trusted triage assigns authors, labels issues/PRs and requests sjungwon03-ai. Verify the automation outcome instead of treating the request label as approval.
- The user authorized merging approved work. Before each merge refresh exact head, reviews and required checks; require approval of the current head and successful CI. Use squash with an exact-head guard, preserving issue closure and DCO/assistance trailers. Do not bypass protections.
- Rebased/revised heads need fresh verification. A reviewDecision value of APPROVED can coexist with an approval of an earlier SHA; compare each review's commit.oid with headRefOid.
- Documentation-only changes use applicable document/link checks; do not add production tests for unchanged behavior. Leave unrelated worktrees and local changes intact.

## Local workspace snapshot

| Path | State when this guide was prepared |
| --- | --- |
| /home/ubuntu/openiam | Main advanced to c7cbbbe, then clean docs/520-agent-handoff branch created for this documentation change. This guide and its plan are the intentional changes on that branch. |
| /tmp/opengranter-benchmark-sort | Clean fix/518-discovery-no-store at d5ce2ce, now merged through squash PR #519. Its temporary directory name is historical; it is not pending benchmark work. |
| /tmp/opengranter-494-sso-management-runtime | Older worktree on test/496-schema-cli-warnings at 49ea25e. No changes made there for this request; inspect ownership/state before reusing it. |

Use git worktree list and git status before relying on these paths. Paths outside this checkout and local environment permissions may differ for another agent. Repository metadata mutations and network commands in the original WSL session needed the configured approval mechanism; never assume that environment-specific permission state transfers to a new agent.

## Refresh commands and first next action

Run from the repository root; fetch does not change local files. Inspect status before switching branches or updating a worktree.

```sh
git status --short --branch
git worktree list
git remote -v
git fetch origin
git log -5 --oneline origin/main
gh pr list --repo Theorvane/OpenGranter --state open
gh issue list --repo Theorvane/OpenGranter --state open
# For each candidate PR, compare review commits to its current head:
gh pr view <number> --repo Theorvane/OpenGranter \
  --json headRefOid,reviewDecision,reviews,statusCheckRollup,mergeStateStatus
```

First reconcile this documentation PR's status and any newer review feedback. Then inventory a concrete remaining #116 workflow against current code, open its implementation issue, create the plan and a new branch, reproduce the gap with a failing test and continue through the required review gates. Ask for the unresolved #7 decisions only if the next chosen slice actually depends on them.


## Bounded Gemini oneOf transport (#592)

On strict:false explicitly object-root schemas, nested oneOf transports1..16 recursively supported branches unchanged on nonstream/native text streams. Gemini officially interprets oneOf as anyOf: exclusive matching is NOT guaranteed. This subset is immutable transport, not generated-output validation, satisfiability or JSON Schema equivalence. Same-node anyOf plus oneOf is locally rejected; malformed/count/depth/root/strict/keyword errors fail before secrets. Existing IAM/limits/persistence/accounting/privacy and capture bounds remain. Deprecated responseJsonSchema, unsupported references/tools/Anthropic, full #116 and unresolved #7 stay open. See [plan](plans/592-gemini-oneof.md) and [contract](../contracts/client-response-formats.md).

## Bounded Gemini local schema references (#594)

The strict:false literal object-root subset additionally transports root-only $defs (1..128 simple ASCII identifier names, max64) and sole-key #/$defs/name references without rewriting. All definitions, including unused ones, and every resolved use are checked against the subset, expanded depth<=16 and shared 20,000-visit budget. Cyclic/dangling/external/escaped refs, reference siblings, nested $defs, $id/$anchor and unsupported schema keywords reject before secrets. No URL is fetched. This is immutable schema transport, not generated-output validation, recursive-reference support, satisfiability or live-model certification. Deprecated responseJsonSchema and strict/tool/Anthropic limitations remain; full #116 and unresolved #7 stay open. See [plan](plans/594-gemini-local-refs.md).
