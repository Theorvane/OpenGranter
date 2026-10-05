# Explicit text block cache directives

## Issue and problem

Issue: [#444](https://github.com/Theorvane/OpenGranter/issues/444), continuing #116 after #442. Text-part cache_control is rejected despite the version-28 selected schema. Clients lose explicit Anthropic-style boundaries and cannot use verified native text-block mappings.

## Scope and expected behavior

Support non-null optional cache_control={type:"ephemeral",ttl?:"5m"|"1h"} on text-only content parts across all five history roles on both chat bases for delegated OpenRouter nonstream/text/refusal/function streams. Managed Anthropic supports instruction/user/assistant blocks with complete unmarked correlated tool results; supplied tool-result block directives reject before secrets because nested partial caching is unverified. Preserve full marked arrays, exact Unicode/whitespace strings, unmarked empty parts, ordering and omission of TTL. Empty marked text rejects as a local restriction following Anthropic's documented exclusion. Plain unmarked arrays retain literal concatenation. Capture/freeze directive type/TTL and message parts once before credentials. Null/malformed/extra/prototype directives, unknown TTL, rich/refusal/prediction directives and unsupported native OpenAI/Gemini blocks reject safely.

Reuse the existing 128-part bound for retained messages. Accept at most four block directives across the complete history and require 1h entries before effective 5m entries (omission is 5m for ordering only, without writing a default). These are documented local restrictions on delegated routes and follow native Anthropic constraints. Reject coexistence with request-level cache_control, root prompt_cache_options or explicit prompt_cache_breakpoint anywhere in history; broader mixed-format precedence/conversion remains unimplemented.

Authentication, approved model/final-provider/host scope, IAM/Deny, limits, secrets, required audit/usage before final delivery, missing usage, provider-reported cache accounting and possibly-billed failure/cancellation remain shared. No caching preferences enter operational records/errors or synthetic echoes. Jev opt-in disclosure keeps its exact text view. No hit, prefix retention, minimum size, model eligibility, savings or billed cost is inferred.

Out of scope: cache directives on tools/rich/refusal/prediction, cache format/resource conversions, mixed automatic/explicit controls, other native providers, live cache certification, full #116 and unresolved #7.

## Design

Extend the existing frozen retained text-part representation with optional cache_control. Retain arrays when either supported marker format is present and identify formats explicitly rather than equating every array with an OpenAI marker. Shared history validation enforces aggregate count/order and rejects unverified combinations before routes/credentials.

Delegated OpenRouter forwards captured parts. Native Anthropic preserves text blocks in user/assistant messages and appends validated tool_use blocks to assistant parts; complete unmarked tool_result strings retain their prior mapping. Reject native tool-result marked arrays instead of promoting nested markers to the outer result or flattening partial boundaries. Instruction messages use native system blocks when a retained array is present; insert plain newline separator blocks between instruction messages to keep the prior joined text view without moving or annotating a caller block. Unmarked instruction histories remain the prior string. Native token equivalence of separate blocks is not guaranteed. Explicit OpenAI markers remain unsupported on native Anthropic; Gemini rejects retained arrays before credentials. No new domain term or irreversible architecture choice is introduced.

Repository grill-with-docs/grilling/domain-modeling research checks whole OpenRouter/SDK shapes and Anthropic native text/system/tool-result constraints from primary sources. Sources: [OpenRouter schema](https://openrouter.ai/openapi.json), [OpenRouter caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Anthropic messages](https://platform.claude.com/docs/en/api/messages/create), official native SDK types. Repeated implementation authorization covers this bounded continuation; larger routing decisions remain open.

Version 28 already selects whole ChatContentText, ChatContentCacheControl and directive/TTL targets. Keep the pin/projector unchanged and verify fresh fixed-host structural equality. Update PRD, architecture, acceptance, compatibility and contracts/text-block-cache-control.md; supersede earlier block exclusions only for this subset.

## TDD plan

First public HTTP/adapter/actual SDK cases expect exact delegated parts and native system/user/assistant/tool_result mappings; current part rejection is the expected red. Cover all roles, both bases/routes/modes/streams, immutable single captures and mutation, 128/129 parts, zero/four/five directives, mixed TTL order across messages, independent controls, native rejection/defaults and malformed/prototype/throwing fields. Exercise authentication/IAM/Deny/limits, required audit/usage, missing/report-only cache usage, opened failures/body cancellation, safe errors and Jev text disclosure. Preserve existing explicit marker and native plain function-history regression suites.

After observed red add minimal representation/format guards and verified native mapping. Run format, focused checks and full npm run check plus compatibility:drift. Controlled SDK fixtures establish local boundary behavior, not live caching.

## Delivery

Issue/new branch/English plan precede code. Link plan/contract and red/green/full/source evidence in PR. Exact-head sjungwon03-ai approval and both required check jobs precede sjungwon03 squash merge and clean synchronized main. Revert retained-block mapping/validators together if needed; no storage/dependency/workflow migration.

## Verification evidence

Preserve explicit cache_control text blocks on both chat bases through delegated OpenRouter and managed Anthropic nonstream/text/refusal/function streams. Delegated histories cover all five roles; native Anthropic preserves instruction/user/assistant blocks and complete unmarked tool results, appending tool_use blocks after assistant text. System blocks keep original caller boundaries with plain newline separators between instruction messages; all-string instructions retain prior behavior. Native tool-result marked arrays reject before secrets because effective nested partial caching is unverified rather than promoting markers to an outer result. OpenAI/Gemini remain unsupported before credential lookup.

TDD: 87 of 106 initial HTTP/adapter/actual SDK tests failed for expected existing block rejection; 19 existing denial/default guards passed. Minimal retention, native mapping and format/count/order guards made the cases green. After refactoring and developer/Jev boundary cases, focused checks passed 395 tests. Full checks passed 4418 tests with one existing PostgreSQL skip, strict types, lint, planning/contracts/fixture secret scan and offline pin integrity. Both installed SDKs exercise 48 controlled socket requests across both bases/routes/delivery modes. Tests cover authentication/IAM/Deny/limits, required audit/usage, reported-only cache accounting/missing usage, opened failures/cancellation, getter capture/mutation, malformed/prototype directives, native rejection, TTL/count bounds and Jev text disclosure.

Official source/SDK research confirms non-null ephemeral block directives and optional 5m/1h TTL, all five delegated roles, native system text blocks and four breakpoint slots with longer TTL first. Local restrictions: 128 retained parts, four total block directives, TTL ordering with omission treated as 5m only for validation, empty marked text rejection and no coexistence with root automatic controls/options or OpenAI explicit markers. Nested tool-result SDK shape alone does not verify partial caching. Separate native blocks do not claim exact token equivalence, and provider/model/size/cache outcome remains upstream.

Version 28 already selects the whole text/cache-control/directive/TTL shapes; pin/projector/digests remain unchanged at 32 fields/22 request-history definitions. Fresh fixed-host compatibility:drift passes. No storage/dependency/workflow change, live hit/retention/savings/billed-cost claim, cache-format conversion or full #116 closure. Unresolved #7 remains open.


Full npm run check passes strict types, lint, 4418 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
