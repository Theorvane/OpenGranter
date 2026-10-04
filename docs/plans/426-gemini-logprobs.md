# Nonstream Gemini token probabilities

## Issue and problem

Issue: [#426](https://github.com/Theorvane/OpenGranter/issues/426), continuing #116 after #420/#424. Managed Google rejects compatible probability controls before credentials and discards reported Candidate.logprobsResult.

## Scope and expected behavior

On both API bases, nonstream Google text and complete function requests capture nullable logprobs/top_logprobs before credential awaits and map exact false/true/zero/20 to generationConfig.responseLogprobs/logprobs. Keep the existing integer 0..20 and true dependency. Null/absence preserves upstream defaults. Existing output caps, thinkingBudget:0 for functions and effort conflicts stay effective; no capability fallback or model-default change.

Preserve reported candidate chosen tokens and alternatives as deep immutable choice-level content probabilities. Native tokens have no bytes, so bytes:null means unavailable; never infer UTF-8 correspondence. Do not reconstruct text, partition function arguments, invent refusal probabilities or derive usage/cost. Native absent/null result omits external metadata. Repeated omitted/null/empty fields are empty per ProtoJSON; an entirely absent/empty top list yields no alternative entries, while a nonempty list must align with chosen steps. Missing optional token/logProbability is incomplete data, not a default empty string/zero. Optional supplied tokenId must fit signed int32 and is omitted externally. Ignore valid native aggregate scores after shape validation. Reuse #420 local token/alternative/string/combined limits.

Prompt/candidate SAFETY retains existing empty output and suppresses probability metadata, so blocked token strings cannot be released. Existing IAM/Deny, limits, fixed hosts, required usage/audit before delivery, missing usage and safe possibly-billed opened failures remain enforced. Native Google streams and all Anthropic supplied probability controls stay unsupported before secrets.

Out of scope: native stream probability semantics, model capability certification, Anthropic probabilities, full probability/billing equivalence, storage/SDK/schema pin changes, live providers, full #116 and unresolved #7.

## Design

Add one pure bounded native probability normalizer, reusing snapshotChatLogprobs for final immutable external capture. Snapshot dense arrays at fixed lengths and allowlist native fields. Wire successful nonstream Google text/function completion projection only; safety branches do not read or expose probability content. Shared direct transport admits captured controls only for nonstream Google and OpenAI, mapping the Google pair into generationConfig without altering other defaults. Keep all stream consumers unchanged.

Repository grilling delegated read-only facts from [Gemini GenerateContent](https://ai.google.dev/api/generate-content), [official proto](https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto) and [SDK token definitions](https://googleapis.github.io/js-genai/release_docs/interfaces/types.LogprobsResultCandidate.html), [ProtoJSON](https://protobuf.dev/programming-guides/json/) and [safety feedback](https://ai.google.dev/gemini-api/docs/safety-settings#safety-feedback). Both lists describe decoding steps; an entirely missing alternative list is projected as no reported alternatives, never padded when partially supplied. The native token fields have optional presence, so no zero/default inference. Native streams lack a verified cumulative/chunk probability guarantee and remain open. No new domain term, costly ADR or unresolved product default is introduced.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/gemini-logprobs.md); explicitly supersede only earlier nonstream Google exclusions.

## TDD plan

First public HTTP/adapter cases expect exact Google native controls and preserved choice probabilities; expected red is HTTP 502 before credentials and dropped metadata. Cover omission/null/false/zero, text/function/signed functions, candidate/prompt safety suppression, native missing/empty lists, aligned steps and chosen-outside-top behavior, optional IDs, missing/nonfinite/malformed token data, sparse/accessor arrays, size bounds, immutable request/response capture, both installed SDKs/bases, auth/implicit/model/provider Deny, limits, selection/outcome audit/ledger failure, missing usage, fixed transport failures and retained native stream/Anthropic rejection.

Record red before implementation. Add the smallest mapper and transport/projection wiring, format, focused verification and npm run check. Keep TypeScript strictness and public security boundaries.

## Delivery

Issue precedes new issue-numbered branch and plan before code. Link English plan/contract and actual red/green/full-check evidence in PR. Require exact-head sjungwon03-ai review and both exact-head CI jobs, then sjungwon03 squash merge and clean main synchronization. Rollback removes optional Google controls/output metadata without historic migration. Fixture SDK checks do not certify live models or full #116.

## Verification evidence

Nonstream managed Google requests previously rejected compatible probability controls and discarded reported token probabilities. Both API bases now capture nullable `logprobs`/`top_logprobs` before credentials, map exact values to native `responseLogprobs`/`logprobs`, and preserve chosen tokens and reported alternatives in immutable choice-level content probabilities for text and complete function responses. Existing sampling, output limits, function thinking defaults and effort conflicts remain enforced.

Native token bytes are unavailable and remain `null`. Optional native token IDs and aggregate scores are validated then omitted. ProtoJSON unset/empty repeated fields preserve empty reports; nonempty alternative lists must align with chosen steps. Missing token/probability fields, unknown keys, malformed numbers/lists and existing local bounds fail safely. Prompt/candidate SAFETY suppresses probability metadata without reading blocked probability accessors. Probabilities never create usage or enter operational records; required ledger/audit failures withhold successful content.

- Red: `node --experimental-strip-types --test test/gemini-logprobs.test.ts test/sdk-gemini-logprobs.test.ts` failed 98 of 120 cases before implementation, reproducing pre-secret rejection and discarded/unchecked native metadata; 22 unchanged denial/unsupported cases passed.
- Green: the expanded focused Gemini/probability/SDK/function/signature/safety/effort suite passes 521 tests. Added 126 cases, including exact bounds, accessor capture, immutable snapshots, native control composition, missing usage, failure paths, and retained native stream rejection.
- Actual OpenAI 7.23.0 and OpenRouter 1.4.18 SDKs complete 40 fixture-backed nonstream requests across both bases, text/functions/signed functions/safety, and complete/missing usage. OpenRouter's existing signature-extension stripping remains explicitly covered; this does not certify a signed round trip through that SDK.

Native Google probability stream semantics, Anthropic mapping, per-model/live-provider guarantees, full #116 and unresolved #7 remain open. Function token reports have no native part/argument association; no partition, bytes, refusal probabilities, usage or costs are synthesized. No schema pin, SDK version or storage migration changes.


Full npm run check passes strict types, lint, 3294 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
