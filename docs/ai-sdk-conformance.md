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
