# OpenRouter AI SDK Conformance

## Reproduce

Use Node >=22.14 and npm ci with the committed lockfile. The pinned test stack is @openrouter/ai-sdk-provider 3.1.0, ai 7.0.153 and zod 4.6.6. Run:

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/ai-sdk-workflows.test.ts test/ai-sdk-controls.test.ts test/ai-sdk-usage-gaps.test.ts test/tool-result-names.test.ts
```

Tests open local loopback sockets and use synthetic tokens and deterministic native JSON/SSE fixtures. They need no provider credentials or live inference. The standard npm run check includes them. In the constrained development environment use the existing CPU-affinity gate documented in [handoff](HANDOFF.md) for the full suite.

## Configure an application

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

const proxyToken = process.env.OPENGRANTER_PROXY_TOKEN;
if (!proxyToken) throw new Error('Proxy token configuration required');
const provider = createOpenRouter({
  baseURL: 'https://gateway.example.com/api/v1',
  apiKey: proxyToken,
});
const model = provider.chat('administrator-published-alias');
const text = await generateText({ model, prompt: 'Hello', maxRetries: 0 });

const result = streamText({
  model,
  prompt: 'Look up the approved fixture',
  maxRetries: 0,
  stopWhen: stepCountIs(2),
  tools: {
    lookup: tool({
      inputSchema: z.object({ key: z.string() }),
      execute: async ({ key }) => ({ key, value: 'application-owned result' }),
    }),
  },
});
for await (const part of result.fullStream) {
  if (part.type === 'error') throw part.error;
  if (part.type === 'text-delta') process.stdout.write(part.text);
}
```

Supply a real proxy token from the application's protected configuration and a published alias visible to that token. The app owns tool execution and access checks. Check error parts rather than treating every finish event as successful server accounting. Use an application abort deadline as appropriate. /v1 is also probed; #540 resolves the previously measured sparse-usage parser failure.

## What is measured

Both bases exercise delegated OpenRouter and managed OpenAI/Anthropic/Gemini for nonstream text, streamed text, tool calls and correlated results, with a fresh IAM evaluation per continuation. Auth/implicit/model/provider Deny, limits, required audit/usage failure, follow-up Deny and cancellation preserve existing boundaries. Upstream model/host/provider scope and per-attempt records are asserted. Optional correlated result names are validated and removed under [the contract](../contracts/ai-sdk-client-workflows.md).

Missing usage may appear as zero in this client even though the ledger remains missing/null. Both bases omit incomplete Gemini usage under #540 and the client displays zero, while the ledger retains known partial counters and an unknown total. These are recorded limits, not fabricated server counters. See [client plan](plans/538-ai-sdk-workflows.md) and [usage correction plan](plans/540-legacy-usage.md) for red/green and full-gate evidence. Full compatibility #116 and Jev #7 remain open; no discovery, signed-Google, image, reasoning, other endpoint or live capability certification follows from these text/tool probes.

Both nonstream bases also expose unknown system_fingerprint as null under [#542](plans/542-legacy-fingerprints.md). This represents unavailable protocol metadata without inventing backend identity. Supplied values remain exact; streaming metadata and error formats retain their separate contracts. The official OpenRouter SDK text and two-request function/result lifecycle is separately verified with omitted upstream fingerprints under [its contract](../contracts/official-sdk-tools.md).

## Nonstream parallel tool reproduction (#546)

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/ai-sdk-nonstream-tools.test.ts
```

For the example above, generateText accepts the same tools and stopWhen configuration as streamText; await its result instead of consuming fullStream. New probes use two parallel calls with different inputs, deliberately complete them in reverse order and inspect exact native follow-up messages for OpenAI/Anthropic/Gemini and delegated OpenRouter on both bases. They cover fresh continuation provider Deny, initial admission failures and required audit/usage persistence failures before tool delivery. No live provider request or client wire rewrite is used. The ordinary npm run check includes all 80 cases.

The pinned AI SDK recomputes totalTokens as input+output. A reported total 7 with input 2/output 3 appears as 5 per step and 10 for the two-step client aggregate; raw gateway responses and per-attempt ledger still retain 7. Native Anthropic's existing adapter derives 5 from its 2/3 counters. This extends the earlier missing-usage warning: client summaries are not the authoritative server accounting or billed cost. A final request denied after client execution cannot undo application-owned side effects. Outcome-audit failure may return 503 after provider work and a successful persisted usage record.

These nonstream cases extend only ordinary function/result coverage. One inline-PNG/tool composition is measured separately under #556 below; broader images/reasoning, signed-Google namespaces, discovery, other endpoints, live providers and other versions remain uncertified for this client; full #116 and Jev #7 stay open.

## Inline PNG reproduction (#550)

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/ai-sdk-inline-images.test.ts
```

Using the configured model above, the input shape is:

```ts
const result = await generateText({
  model,
  maxRetries: 0,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Describe the approved image.' },
      { type: 'image', image: applicationOwnedPngBytes, mediaType: 'image/png' },
      { type: 'text', text: 'Use a short answer.' },
    ],
  }],
});
```

applicationOwnedPngBytes is a Uint8Array loaded by the application from its approved source. streamText accepts the same image input; consume error parts normally and use an application deadline. The 40 synthetic probes use the existing canonical PNG fixture, explicit media type and controlled native responses, with retries disabled and no credential/live inference requirement. They install a media-download hook that requires an empty URL plan and retain the bounded local provider-fetch guard. This tests inline serialization without making claims about remote URL handling.

Both bases and all four adapters preserve exact upstream bytes/MIME/text order. Admission Deny, limits and required persistence failures retain shared boundaries; stream cancellation stops upstream and records possible billing privately. Success fixtures supply input/output counters 2/1 and explicit totals 3 where supported; native Anthropic retains its existing derived total of 3. These normalized counters do not establish image tokenization or billed price. Production code, pins, dependencies and storage are unchanged. Other image controls, image+tool loops, other modalities, signed Gemini, live vision capability and full #116 remain separate; Jev #7 is unchanged. See [plan](plans/550-ai-sdk-inline-images.md) and [contract](../contracts/ai-sdk-client-workflows.md#inline-png-workflows-550).

## Structured object reproduction (#552)

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/ai-sdk-structured-output.test.ts
```

```ts
import { Output, generateText, streamText } from 'ai';
import { z } from 'zod';

const output = Output.object({
  schema: z.object({ answer: z.string() }),
  name: 'answer',
  description: 'A short answer object',
});
const generated = await generateText({
  model,
  output,
  prompt: 'Return a short answer.',
  maxRetries: 0,
});
const value = generated.output;

const streaming = streamText({
  model,
  output,
  prompt: 'Return a short answer.',
  maxRetries: 0,
});
for await (const part of streaming.fullStream) {
  if (part.type === 'error') throw part.error;
}
const streamedValue = await streaming.output;
```

Use an explicitly approved OpenAI or delegated route and an application abort deadline. The pinned provider emits a measured draft-07 schema, name/description and strict:true. Direct Anthropic/Gemini json_schema remains unsupported before provider credential lookup. No live model acceptance is established by controlled sockets.

Client parsing is separate from server completion. Malformed JSON/wrong property types cause NoObjectGeneratedError containing generated text and usage locally, after the server has recorded successful provider work. Default Zod object validation strips extra properties despite the advertised additionalProperties:false; gateway text is preserved. A parsed object does not certify full JSON-schema enforcement.

A streaming audit/usage failure after delivered text produces server error parts without actual final usage/DONE. The pinned SDK can nevertheless resolve its output object from that text, so do not use output resolution as a persistence acknowledgment or ignore stream errors. Nonstream persistence failures withhold the result. Server operational records and public errors exclude schema/content/credentials; SDK-local exceptions are a separate application boundary. All 48 new cases use bounded local sockets, retries disabled and controlled usage; source pins, dependencies, production source and storage are unchanged. Full #116, other Output modes/native mappings/live capabilities and unresolved Jev #7 remain open. See [plan](plans/552-ai-sdk-structured-output.md) and [contract](../contracts/ai-sdk-client-workflows.md#structured-object-workflows-552).

## Inline-image tool reproduction (#556)

```sh
node --disable-warning=ExperimentalWarning --experimental-strip-types --test test/ai-sdk-image-tools.test.ts
```

Combine the inline-PNG messages example above with application-owned tools and stopWhen:stepCountIs(2) from the tool example; use generateText or consume streamText.fullStream and inspect error parts. The 160 new cases exercise both bases/all four adapters using exact native image/history capture. Nonstream probes run two parallel lookups in reverse completion order; streaming probes run one read function. PNG MIME/bytes/text order survives the subsequent function/result history without client or server wire rewrites. No download hook is allowed to request a URL; registered upstream transport and local client endpoint guards remain bounded.

Fresh authentication failure, implicit/model/provider Deny or limit exhaustion after tool execution prevents a second provider/secret access. First- or second-request required usage/outcome-audit faults withhold completion acknowledgment; on streams inspect actual error/final usage/DONE frames separately from SDK events and already-delivered content. Completed local tools and provider work cannot be undone by a later error. Each successful request retains a distinct ledger request ID, existing counters and operational content/credential privacy. Client summaries still recompute nonstream totals; they are not authoritative accounting or billed cost.

These fixtures need no credentials or live inference and run in the standard npm run check. They certify one canonical inline PNG combined with ordinary functions only; signed Gemini, broader media/controls, remote downloads, other tools/versions/endpoints and live vision support remain separate. Production code, dependencies, six source pins and storage are unchanged. Full #116 and Jev #7 remain open. See [plan](plans/556-ai-sdk-image-tools.md) and [contract](../contracts/ai-sdk-client-workflows.md#inline-image-tool-continuations-556).

## Native Gemini schema limitation update (#572)

Direct Gemini now has a bounded explicit strict:false schema transport subset with no tool controls (see [contract](../contracts/client-response-formats.md#bounded-direct-gemini-json-schemas-572)). The pinned AI SDK Output.object emits strict:true, so its existing native-Gemini pre-secret rejection is unchanged. Do not treat this transport addition as AI SDK native structured-output certification.


## Bounded Gemini literal null-root schemas (#606)

Explicit strict:false transport additionally accepts literal type:null roots with existing annotations and optional root-only definitions. All unused definitions, local-reference/cycle checks, expanded depth<=16, shared20,000-visit budget and wrong-type keyword restrictions remain enforced before credentials. Captured schemas pass unchanged on nonstream and native text streams. Null enums, malformed type arrays, nested definitions and strict/tool/Anthropic combinations remain unsupported; actual AI SDK strict:true rejection is unchanged. This supersedes earlier literal-root-null-only exclusions, not generated-output validation, forced-null output, satisfiability, equivalence or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged. Full #116 and unresolved #7 stay open. See [plan](plans/606-gemini-null-root.md).


## Bounded Gemini dotted definition keys (#614)

Explicit strict:false transport accepts literal ASCII dots after the initial letter/underscore in root-$defs keys and matching #/$defs/name references, retaining 1..64 characters. Direct pointers and named anchor aliases transport unchanged through both HTTP bases, actual OpenAI SDK sockets and native text streams. Dots are literal: no percent decoding, path normalization, JSON Pointer escaping or remote fetching. Canonical mixed cycles, unused definitions, depth16/shared20,000 visits/128 definitions, strict/tool/Anthropic pre-secret rejection and IAM/limits/accounting/persistence/privacy remain enforced. No generated-output validation, equivalence, live-model or operational certification. This supersedes only the earlier dotted-definition-key exclusion; full #116 and unresolved #7 remain open. See [plan](plans/614-gemini-dotted-definition-keys.md).


## Bounded Gemini root identity (#616)

Root-only canonical HTTPS $id metadata now survives immutable Gemini nonstream/native-stream transport with unchanged local-only references and resource/IAM/privacy boundaries. Actual OpenAI SDK sockets on both bases preserve captured schema identity. No network resolution, nested base changes, generated-output validation or live/operational certification. See [plan](plans/616-gemini-root-schema-id.md); full #116 and unresolved #7 remain open.


## Bounded Gemini root anchor metadata (#618)

Explicit strict:false Gemini schemas may carry root $anchor using the existing 1..64-character ASCII anchor grammar. Root anchors coexist with optional root $id and typed/nullable/union/local-reference roots; duplicate root/definition names reject before credentials. Named root references remain invalid recursive schemas; existing local root-$defs resolution is unchanged, with no fetching or nested-base changes. Immutable both-base HTTP, actual OpenAI SDK sockets and native captured streams retain the metadata. Nested non-definition anchors, malformed/dangling/cyclic refs, unused invalid definitions and strict/tool/Anthropic exclusions remain pre-secret failures. Depth16/shared20,000 visits/128 definitions and IAM/limits/accounting/persistence/privacy bounds remain. This supersedes earlier root-anchor exclusions only, not generated-output validation, equivalence or live/operational certification. Full #116 and unresolved #7 remain open. See [plan](plans/618-gemini-root-anchor.md).
