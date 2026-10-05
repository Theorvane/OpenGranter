# Function tool cache directives

## Issue and problem

Issue: [#446](https://github.com/Theorvane/OpenGranter/issues/446), continuing #116 after #444. Official ChatFunctionTool exposes cache_control on the outer portable function wrapper, but local snapshots reject it and managed Anthropic has no corresponding tool-level mapping.

## Scope and expected behavior

Support optional non-null cache_control={type:"ephemeral",ttl?:"5m"|"1h"} on function-tool wrappers through both chat bases for delegated OpenRouter and managed Anthropic nonstream/text/refusal/function output and function-capable streams. Preserve names/descriptions/parameters/strict, tool choice/parallel controls, declared order and complete function/result history. Omitted controls add no directive/TTL/header/default. Snapshot/freeze known fields once before credential awaits. Null/malformed/extra/prototype directives, unknown TTL/type, nested function cache fields and unsupported server/custom tools reject safely before routes/credentials.

Extend the existing explicit-block rules to the complete prompt: inspect tool directives first, then system/instruction/message directives, allowing at most four total directives and requiring 1h before effective 5m (omission counts as 5m only for validation). Support tool and text block combinations when their combined count/order is valid. Reject coexisting request cache_control, prompt_cache_options or non-null OpenAI prompt_cache_breakpoint anywhere as existing unverified mixed-format restrictions. Native OpenAI/Gemini supplied tool directives reject before secrets without substitutions; unchanged plain tools remain supported.

Authenticated IAM/Deny, approved model/final-provider/host scope, limits, required audit/usage before final delivery, reported-only cache accounting, missing usage and possibly-billed failure/cancellation remain shared. Keep directives, private function/schema content and keys outside operational records/errors/echoes. No model eligibility, caching effectiveness, retention, savings, usage or billed cost is inferred. Jev still receives only its configured text view.

Out of scope: server/custom tools, nested cache fields, native OpenAI/Gemini equivalents, automatic/explicit mixed precedence, OpenAI marker conversion, native partial tool-result caching, live certification, full #116 and unresolved #7.

## Design

Add a frozen optional directive to FunctionTool using the shared directive validator. Delegated serialization keeps the wrapper. Managed Anthropic emits cache_control alongside name/input_schema/description/strict on the native custom tool. Native Gemini's exported function converter rejects marked tools; direct native OpenAI rejects before body preparation/credentials. Extend shared complete-prompt validation with captured tools, preserving all existing block and OpenAI-marker rules. No new domain term, irreversible choice, storage or dependency change is introduced.

Repository grill-with-docs/grilling/domain-modeling fact research confirms wrapper versus nested placement and native ordering/mapping. Sources: [OpenRouter schema](https://openrouter.ai/openapi.json), installed SDKs, [OpenRouter caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [native custom-tool type](https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/types/tool_param.py). Standing implementation authorization covers this bounded continuation; unresolved routing choices remain open.

Version 28 already selects whole ChatFunctionTool, ChatContentCacheControl and directive/TTL targets (32 fields/22 request-history definitions). Keep pin/projector unchanged and verify fresh fixed-host equality. Update PRD/architecture/acceptance/compatibility and contracts/function-tool-cache-control.md; supersede prior tool-definition exclusions only for portable wrapper directives.

## TDD plan

First failing HTTP/adapter/actual SDK cases expect exact wrapper/native tool retention across both bases/routes/modes; current wrapper rejection is expected red. Cover omission/5m/1h, tools plus marked history, aggregate zero/four/five and mixed TTL ordering across tools→instructions→messages, metadata/choice/parallel independence, malformed/nested/prototype/throwing fields, immutable getter capture/mutation, native rejection/defaults and exported native converter behavior. Cover authentication/IAM/Deny/limits, required audit/usage, reported-only/missing usage, opened failure/cancellation, privacy and correlated follow-up history.

After observed red add minimal capture/native mapping/aggregate validation. Format, focused existing tool/block/breakpoint regressions, npm run check and compatibility:drift. Controlled SDK sockets validate local boundaries without live inference.

## Delivery

Issue/new branch/English plan precede production code. PR links plan/contract and reports red/green/full/source evidence and remaining limits. Exact-head sjungwon03-ai approval plus both required check jobs precede sjungwon03 squash merge and clean synced main. Rollback reverts tool capture/mapping and aggregate rules together; no migration or privileged workflow change.

## Verification evidence

Preserve optional cache_control on portable function-tool wrappers through both chat bases for delegated OpenRouter and managed Anthropic nonstream/text/refusal/function output and function-capable streams. Immutable pre-secret capture retains tool fields/order and exact directive omission; Anthropic maps it to native tool level. OpenAI/Gemini reject supplied directives before credentials, with an explicit exported Gemini converter guard. Existing choice/parallel/schema/strict and correlated call/result behavior stays shared.

Complete-prompt validation now inspects tools before instruction/message blocks and enforces four total directives and 1h-before-effective-5m ordering across both. Valid tool/text combinations are supported; automatic root controls/options and OpenAI history breakpoints remain locally rejected without unverified precedence/conversion. Private tool/schema/directive values never become operational metadata or synthetic echoes; IAM/Deny/limits/approved hosts, required audit/usage, reported-only/missing usage and safe possibly-billed failure/cancellation remain enforced.

TDD: 81 of 99 initial public HTTP/adapter/actual SDK cases failed for expected wrapper rejection; 18 denial/default guards passed. Minimal capture/mapping/aggregate guards made focused regression checks pass 446 tests. Full npm run check passed strict typing, lint, 4517 tests with one existing PostgreSQL skip, planning/contracts/fixture secret scan and offline pin integrity. Both installed SDKs exercise 48 controlled socket requests across both bases/routes/output modes/streams, including marked history and native mappings. Success, auth/IAM/Deny/limits, persistence failures, aggregate count/order, malformed/nested/prototype/throwing fields, credential-await mutation, missing/reported usage, opened failures and body cancellation are covered.

Version 28 already selects whole ChatFunctionTool and cache/directive/TTL targets; pin/projector/digests remain unchanged (32 fields/22 request-history definitions). Fresh official fixed-host compatibility:drift passes. Unknown-TTL SDK extensions and native nullable directives remain outside the documented local subset. No server/custom tool enablement, native OpenAI/cache-format conversion, mixed-control guarantee, native partial tool-result cache support, live model/hit/retention/savings/billed-cost claim, storage/dependency/workflow change or full #116 closure. Unresolved #7 remains open.


Full npm run check passes strict types, lint, 4517 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
