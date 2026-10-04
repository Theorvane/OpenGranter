# OpenCode managed Anthropic and Gemini conformance

## Issue and problem

Issue: #414, continuing #116. The pinned OpenCode 1.18.5 harness verifies delegated and managed OpenAI workflows only. Recently activated native Anthropic/Gemini text/functions require named-client evidence. The current fixture hardcodes OpenAI native requests and accounting destinations.

## Scope and expected behavior

Extend isolated fixture sockets and actual installed OpenCode probes to managed Anthropic/Gemini on both compatible bases. Require explicit custom-provider/model registration, rendered completion, fixture-only read tool execution and correlated native result history, fresh per-request IAM/limits, model/provider Deny, follow-up provider Deny, administrator output caps and process disconnect with failed possibly-billed missing usage. Measure default signed Gemini metadata loss and verify an explicitly selected Google SDK metadata namespace preserves complete same-part signatures.

No live provider, real credential, automatic model equivalence, thinking default, signature bridge, SDK patch, external config/plugin or new product decision. Keep broader named clients and #116 open; #7 remains unresolved.

## Design

Reuse captured registered native function dispatch, which also accepts the text subset. Generalize only the conformance fixture's trusted selected registration and mocked native protocol. Validate fixed host, credential header, native controls/declarations, complete call/result correlation and accounting identity. Add a signature-required Google fixture to verify raw wire replay and measure actual-client loss without fabrication. Keep process environment allowlist, temporary Git/config/data isolation, exact file permissions, bounded output/time and cleanup.

Repository grilling delegates environment/client facts; settled protocol subsets and existing isolation need no new glossary term or costly ADR. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/opencode-native-providers.md). Keep runtime adapter behavior unchanged unless a separately reproduced in-scope bug requires a documented regression fix.

Read-only source/runtime probes confirm OpenCode 1.18.5 passes {name:providerID,...options} to its OpenAI-compatible SDK 2.0.41 factory. Explicit options.name='google' aligns its incoming metadata with the outgoing providerOptions.google.thoughtSignature converter. Preserve the custom provider/model key and literal alias; this option conveys no IAM authority or destination override. Add a separate opt-in configuration argument rather than infer model names or change every client. Test default loss and configured success; standalone late signatures remain unsupported. Sources: [OpenCode factory](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.5/packages/opencode/src/provider/provider.ts) and [SDK converter](https://raw.githubusercontent.com/vercel/ai/@ai-sdk%2Fopenai-compatible@2.0.41/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts).

## TDD plan

Before script changes, add socket cases selecting Anthropic/Google registrations. Expected red: existing fixture still dispatches OpenAI, emits OpenAI bodies and accounts against the wrong provider. Cover native text, complete tool/result history, configured caps, Deny/limits, follow-up Deny, cancellation and private metadata. Signed Google wire round trips must succeed; deliberate signature stripping must fail safely possibly billed.

Implement minimal native fixture generation and update actual-client runner assertions for native history/declarations. Run focused tests, pinned installed OpenCode probes, npm run format and full npm run check. Record actual unsupported client behavior rather than rewriting assertions to certify it.

Installed-client probes exposed auxiliary text requests before real read calls. Switch the follow-up Deny fixture only after issuing a read call, with regression cases across all three native kinds/bases. Respect omitted Google generation settings rather than require an injected default. The default signed-Google probe observes missing-signature replay failures, but OpenCode's outer session retry policy has no cap for 5xx despite SDK maxRetries:0. Deliberately stop that probe at the existing five-second bounded process deadline and require native result replay without a signature plus failed possibly-billed missing accounting; do not claim immediate terminal client error or successful default continuation. Configured signed probes must render final completion without this termination.

## Delivery

Issue, new branch and English plan precede code. Link plan/contract, red/green evidence, actual installed-client results and material limitations in PR. Exact-head sjungwon03-ai review and both CI checks precede sjungwon03 squash merge and clean synchronized main. Fixtures do not certify live providers; rollback only removes extended probes.

Pinned retry behavior is evidenced by [session retry](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.5/packages/opencode/src/session/retry.ts), [processor](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.5/packages/opencode/src/session/processor.ts) and [LLM invocation](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.5/packages/opencode/src/session/llm.ts). SDK maxRetries does not govern the outer policy; no undocumented retry setting is added.

## Verification evidence

The pinned OpenCode conformance harness previously covered delegated and managed OpenAI only. Extend it to administrator-registered managed Anthropic and Gemini text/complete-function streams on both bases. Mock fixed native hosts, validate credentials/declarations/result correlation/captured scope and supplied output caps, and retain exact registration, actual inference-provider accounting, fresh IAM/limits, initial and follow-up Deny, cancellation and private operational metadata.

Add an explicit Google SDK metadata namespace option (provider.opengranter.options.name='google') while keeping opengranter/chat, gateway base URL and proxy token. Actual OpenCode 1.18.5 read/result probes preserve complete same-part signatures and render final answers with this setting. Default namespace loses the signature; its outer session retry policy retries 5xx without a cap, so negative probes intentionally terminate at the existing five-second deadline after verifying unsigned native replay and failed possibly-billed missing usage. Do not claim normal default completion or final client error, and do not invent an unsupported retry setting. Installed OpenRouter SDK stripping and late signature deltas remain independent gaps.

TDD: initial twenty-one expected failures reproduce OpenAI-only fixture/provider accounting and missing signature configuration (eight existing denial boundaries pass); an isolated original-main snapshot confirms the corrected assertions fail for those same reasons. Six additional red regressions reproduce premature follow-up Deny on auxiliary text requests; two reproduce rejection of omitted Google generation settings. Green focused socket/process verification passes sixty-three cases, with thirty-seven added regressions. The Deny fixture now switches only after a read call is issued, and Google omitted settings stay omitted.

Pinned installed-client validation npm run compatibility:opencode -- /Users/jungwon/.opencode/bin/opencode passes fifty probes: ten delegated/OpenAI cases, thirty-six managed OpenAI/Anthropic/Google cases including follow-up Deny, and four Google signature probes across both bases. Forty-six ordinary/Deny/cancel probes, two intentionally bounded default-signature loss probes and two configured signed successes are separately verified. Configured Google probes execute read, preserve exact signature replay and render final completion. Default probes verify unsigned native replay and failed possibly-billed missing accounting before deliberate five-second termination; they do not certify default signed success or a final client error. The default CI socket/process suite passes sixty-three cases, including thirty-seven added regressions. This is fixture conformance, not live-provider certification.

Preserve environment allowlist, isolated temporary Git/config/data/cache/state, exact read permission, disabled plugins/external config, process output/deadline bounds and cleanup. No live upstream/key, dependency/schema pin, runtime adapter/thinking default/model eligibility or architecture change. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

Full npm run check passes strict types, lint, 2506 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
