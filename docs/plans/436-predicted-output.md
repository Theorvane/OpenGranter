# Bounded predicted text outputs

## Issue and problem

Issue: [#436](https://github.com/Theorvane/OpenGranter/issues/436), continuing #116 after #434. Compatible SDKs can submit expected output text, but both chat bases currently reject prediction.

## Scope and expected behavior

Accept optional nullable {type:"content",content:string|[{type:"text",text:string}]} for managed OpenAI/delegated OpenRouter nonstream and text/refusal streams. Null/omission leaves the field unset; preserve exact empty/whitespace/Unicode strings, empty arrays and text-part order without joining or coercion. Capture/freeze root, content array and known own part fields once before credential awaits. Keep the complete HTTP body bound; impose a documented local maximum of 128 text parts and reject extra keys/non-record/malformed parts. This count restriction is local, not a published source bound.

Use an explicit conservative portable subset: no normalized supplied tools/tool-choice/parallel-call or probability controls (including false/empty/none), no function history, no positive frequency/presence penalties and no non-null max_completion_tokens. Existing nullable unset control normalization remains shared. max_tokens and administrator caps remain existing passthrough; the official predicted-output guide does not discuss max_tokens, so no universal compatibility guarantee is made. Native Anthropic/Gemini supplied predictions reject before secrets without assistant-prefill/models.predict translation; null/omission preserves defaults. Model eligibility and upstream support remain administrator/provider concerns; do not change catalog/routing defaults.

Prediction is client content, not a permission, usage counter, cache key or response. Keep it outside operational records/errors and never synthesize request-field echoes; actual upstream response content may naturally match the prediction and never synthesize accepted/rejected prediction tokens, savings or billed cost. Preserve complete approved destination IAM/Deny, limits, fixed hosts, required audit/ledger, missing usage, cancellation and safe possibly-billed errors. Out of scope: tool/probability combinations, richer parts, native prefill, output verification, model guarantees/live certification, multimodal/modality changes, broader endpoints, full #116 and unresolved #7.

## Design

Add pure prediction snapshot and combination validation helpers. Capture max_completion_tokens once where existing output-limit resolution occurs, so validation and prepared caps share one value before credentials. Apply combination validation to captured tool/probability/penalty/message values at all three public request boundaries; only OpenAI/OpenRouter bodies receive predictions. Do not inject expected content into messages or routing decision-service prompt disclosure. No new domain term or costly ADR.

Repository grilling delegates factual research from [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [OpenAI Predicted Outputs](https://developers.openai.com/api/docs/guides/predicted-outputs), native provider docs and installed SDKs. The current OpenAI guide lists GPT-4o/mini and GPT-4.1/mini/nano, supports streaming and excludes tools/functions, logprobs, positive penalties, max_completion_tokens, n>1 and nontext modalities. Local exclusion of all normalized supplied tool/probability fields is deliberately broader than those precise restrictions. SDK stripping/extra native prompt_cache_breakpoint parts does not authorize forwarding unknown part fields.

Version 25 adds only prediction plus whole Prediction/PredictionContentText to 30 selected fields/18 request-history definitions. Removing these selections must reproduce version 24 canonically. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/predicted-output.md) and schema drift contract.

## TDD plan

First public HTTP/adapter and actual SDK cases expect preserved string/part predictions: red reproduces unknown-field rejection/dropped content. Cover omitted/null/empty/Unicode/long strings under body bound, empty and 128/129-part arrays, malformed/extra fields, native defaults/rejection, every restricted combination and nonpositive penalty/max_tokens passthrough, mutable/throwing root/content/type/text getters, exact part order, body limits, both bases, nonstream/text/refusal streams and actual SDKs. Verify auth/implicit/model/provider Deny, limits, selection/outcome audit and ledger failure, missing usage, safe transport failure and body cancellation. Source tests traverse nullable prediction and text-part target, detect nested type/enum/required/default/count/length/extensions, annotations, malformed/missing source and stale/rehashed invalid pins.

After recorded red, implement minimum helpers/projection. Format, focused regressions, full npm run check and explicit fixed-host compatibility:drift. No live inference or model-support certification.

## Delivery

Issue/new branch/plan precede implementation. Record red/green, source/projection provenance, canonical prior-selection equality, SDK fixture limits and material remaining gaps in the PR. Exact-head sjungwon03-ai review plus both CI precede sjungwon03 squash merge and clean main synchronization. Rollback removes optional support and restores pin/projector together; no storage migration or new dependency.

## Reviewed provenance and limits

Fresh fixed-host source on 2026-10-05 retains canonical SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458. Version-25 projection SHA-256 is 97a20d69c42f3885237fde3851a268eed07dc797ac914b07567bae64675af114. Removing only prediction and its root/text-part definitions reproduces version 24 canonically; prior maps remain unchanged. No source count/length/extra-key constraint is invented.

Current primary guide lists GPT-4o/mini and GPT-4.1/mini/nano and documents that rejected prediction tokens can incur completion charges. This adapter changes no catalog eligibility, derives no cost/savings and subtracts no category counts. max_tokens support is unspecified by that guide; existing cap passthrough is not a live guarantee. Actual matching upstream response text remains valid; only synthetic request-field echoes are excluded.

## Verification evidence

Both chat bases previously rejected prediction. Managed OpenAI/delegated OpenRouter nonstream and text/refusal streams now preserve nullable optional expected string/text-part outputs, with exact empty/Unicode/whitespace values, empty arrays and part order. Capture and freeze required own root/part fields before credentials; null/omission inject no field. Existing full body limits and an explicit local 128-part maximum apply; malformed/non-record/extra fields reject before route/credential work.

The conservative portable subset rejects normalized supplied tools/tool-choice/parallel/probability controls, including empty/none/false, function history, positive penalties and non-null max_completion_tokens. Capture that alias once for validation and output-limit resolution. Nullable unset controls, nonpositive penalties and existing max_tokens/admin caps retain passthrough. The official guide does not discuss max_tokens; no universal model/control guarantee is made. Native Anthropic/Gemini supplied predictions fail before secrets without prefill/alternate-method translation; null/omission preserves defaults.

Expected text remains private client content, excluded from operational records/errors and synthetic request-field echoes; actual matching upstream response text remains valid output. No prompt-history/routing disclosure, IAM identity, usage/savings/billed-cost derivation or rejected-token subtraction. Existing informational prediction-token categories, missing usage, approved hosts/models/providers, IAM/Deny/limits, required audit/ledger and safe failure/cancellation behavior remain shared.

- Red: 102 of 264 public request/SDK/source cases failed before implementation, reproducing unknown-field rejection, dropped fields/combinations and absent transitive selections.
- Green: 805 focused prediction, cache-control, caller metadata/user/key, actual SDK and source regressions pass. Added 112 cases covering boundaries, exact part ordering, single/throwing root/content/type/text/alias capture, restricted combinations, native defaults/rejection, authentication/Deny/limits, persistence/missing usage, opened failures, body cancellation, reported prediction-token categories and matching actual output without synthetic echo.
- Actual installed OpenAI 7.23.0 and OpenRouter 1.4.18 complete 64 fixture-backed gateway socket requests with strings/parts across both routes/bases, text/refusal and nonstream/stream. No live model/latency/billing certification.
- Version 25 adds only prediction and whole Prediction/PredictionContentText to 30 selected fields/18 request-history definitions. Removing these three selections reproduces version 24 canonically. Fresh canonical official source SHA-256 remains 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection SHA-256 is 97a20d69c42f3885237fde3851a268eed07dc797ac914b07567bae64675af114. Transitive nullable/type/enum/required/default/count/length/extensions are tracked without invented local source constraints; missing/malformed/stale/rehashed invalid maps reject. Explicit fixed-host compatibility:drift passes.

Rich parts, broader combinations/native mappings, model eligibility/live support, complete #116 and unresolved #7 remain open. No storage migration, dependency, destination registration, response/usage algorithm or workflow-authority change.


Full npm run check passes strict types, lint, 3957 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
