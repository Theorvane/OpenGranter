import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError, generateText, streamText } from 'ai';
import { openCodeGatewayFixture } from '../scripts/opencode-gateway-fixture.ts';
import { withAiSdkServer } from './ai-sdk-client-fixture.ts';
import { imageFixture, inlineUrl } from './inline-image-inputs-fixture.ts';
import { nativeImageFixture } from './native-inline-images-fixture.ts';
import { type ProbabilityKind, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

const base64 = inlineUrl.split(',')[1] ?? assert.fail('Missing fixture image bytes');
const noImageDownloads = async (requested: readonly unknown[]) => {
  assert.equal(requested.length, 0, 'Inline bytes must not request external image downloads');
  return [];
};
const input = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'private image question Ω' },
      {
        type: 'image' as const,
        image: new Uint8Array(Buffer.from(base64, 'base64')),
        mediaType: 'image/png',
      },
      { type: 'text' as const, text: 'private trailing text' },
    ],
  },
];
function fixture(
  kind: ProbabilityKind,
  stream: boolean,
  gate?: NonNullable<Parameters<typeof imageFixture>[1]>['gate'],
) {
  const options = { stream, ...(gate === undefined ? {} : { gate }) };
  return kind === 'anthropic' || kind === 'google'
    ? nativeImageFixture(kind, options)
    : imageFixture(kind, options);
}
function exactImageHistory(kind: ProbabilityKind, body: Record<string, unknown>) {
  const first = 'private image question Ω',
    last = 'private trailing text';
  if (kind === 'google') {
    assert.deepEqual(body.contents, [
      {
        role: 'user',
        parts: [
          { text: first },
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: last },
        ],
      },
    ]);
  } else if (kind === 'anthropic') {
    assert.deepEqual(body.messages, [
      {
        role: 'user',
        content: [
          { type: 'text', text: first },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: last },
        ],
      },
    ]);
  } else {
    assert.deepEqual(body.messages, [
      {
        role: 'user',
        content: [
          { type: 'text', text: first },
          { type: 'image_url', image_url: { url: inlineUrl } },
          { type: 'text', text: last },
        ],
      },
    ]);
  }
}
function privacy(audit: unknown, usage: unknown) {
  assert.doesNotMatch(
    JSON.stringify([audit, usage]),
    /image_url|imageUrl|base64|data:image|private image|private trailing|iVBOR|fixture-(?:proxy|provider|upstream)-(?:key|token)/u,
  );
}

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const) {
    for (const stream of [false, true]) {
      test(`AI SDK image ${base} ${kind}: ${stream ? 'streamText' : 'generateText'} preserves inline PNG and text order`, {
        timeout: 15000,
      }, async () => {
        const f = fixture(kind, stream);
        await withAiSdkServer(f.ports, base, 'fixture-proxy-key', async (model) => {
          const options = {
            model,
            messages: input,
            experimental_download: noImageDownloads,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(10000),
          };
          if (stream) {
            const result = streamText({ ...options, onError: () => {} });
            for await (const part of result.fullStream) if (part.type === 'error') throw part.error;
            assert.ok((await result.text).length > 0);
            assert.equal(await result.finishReason, 'stop');
            assert.equal((await result.usage).totalTokens, 3);
          } else {
            const result = await generateText(options);
            assert.equal(result.text, 'reply');
            assert.equal(result.finishReason, 'stop');
            assert.equal(result.usage.totalTokens, 3);
          }
        });
        assert.equal(f.sent.length, 1);
        exactImageHistory(kind, f.sent[0] ?? assert.fail('Missing upstream request'));
        assert.equal(f.counts().secrets, 1);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'succeeded');
        assert.equal(f.records[0]?.usage.totalTokens, 3);
        probabilityPrivacy(f);
        privacy(f.audits, f.records);
      });

      test(`AI SDK image ${base} ${kind}: ${stream ? 'streamText' : 'generateText'} retains admission and persistence gates`, {
        timeout: 15000,
      }, async () => {
        for (const gate of [
          'auth',
          'implicit',
          'model',
          'provider',
          'limit',
          'selection',
          'audit',
          'usage',
        ] as const) {
          const f = fixture(kind, stream, gate);
          const wire: string[] = [];
          await withAiSdkServer(
            f.ports,
            base,
            'fixture-proxy-key',
            async (model) => {
              const options = {
                model,
                messages: input,
                experimental_download: noImageDownloads,
                maxRetries: 0,
                abortSignal: AbortSignal.timeout(10000),
              };
              if (stream) {
                const result = streamText({ ...options, onError: () => {} });
                const errors: unknown[] = [];
                for await (const part of result.fullStream)
                  if (part.type === 'error') errors.push(part.error);
                assert.ok(errors.length > 0, gate);
                if (gate !== 'audit' && gate !== 'usage') {
                  assert.ok(APICallError.isInstance(errors[0]));
                  assert.equal(
                    errors[0].statusCode,
                    gate === 'auth'
                      ? 401
                      : gate === 'limit'
                        ? 429
                        : gate === 'selection'
                          ? 503
                          : 403,
                  );
                }
              } else {
                await assert.rejects(generateText(options), (error: unknown) => {
                  assert.ok(APICallError.isInstance(error));
                  assert.equal(
                    error.statusCode,
                    gate === 'auth'
                      ? 401
                      : gate === 'limit'
                        ? 429
                        : ['selection', 'audit', 'usage'].includes(gate)
                          ? 503
                          : 403,
                  );
                  return true;
                });
              }
            },
            async (response) => {
              wire.push(await response.text());
            },
          );
          assert.equal(wire.length, 1);
          assert.doesNotMatch(
            wire[0] ?? '',
            /data:image|iVBOR|private image|private trailing|fixture-provider-key|fixture-proxy-key/u,
          );
          if (stream) assert.doesNotMatch(wire[0] ?? '', /\[DONE\]|"usage"\s*:\s*\{/u);
          const attempted = gate === 'audit' || gate === 'usage';
          assert.equal(f.sent.length, attempted ? 1 : 0);
          assert.equal(f.counts().secrets, attempted ? 1 : 0);
          if (attempted)
            exactImageHistory(kind, f.sent[0] ?? assert.fail('Missing attempted image call'));
          privacy(f.audits, f.records);
          probabilityPrivacy(f);
        }
      });
    }

    test(`AI SDK image ${base} ${kind}: cancellation interrupts the upstream and retains possible billing`, {
      timeout: 15000,
    }, async () => {
      const provider = kind === 'openrouter' ? 'openai' : kind;
      const f = openCodeGatewayFixture(
        'cancel',
        kind === 'openrouter' ? 'delegated' : 'managed',
        provider,
      );
      const controller = new AbortController();
      let interrupted: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        interrupted = resolve;
      });
      await withAiSdkServer(
        {
          ...f.ports,
          writeAudit: async (event) => {
            await f.ports.writeAudit(event);
            if (event.kind === 'stream-interrupted') interrupted();
          },
        },
        base,
        'fixture-proxy-token',
        async (model) => {
          const result = streamText({
            model,
            messages: input,
            experimental_download: noImageDownloads,
            maxRetries: 0,
            abortSignal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
            onError: () => {},
          });
          let content = false,
            terminal = false;
          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              content = true;
              controller.abort();
            }
            if (part.type === 'finish-step') terminal = true;
          }
          assert.equal(content, true);
          assert.equal(terminal, false);
          await finished;
        },
      );
      assert.equal(f.sent.length, 1);
      exactImageHistory(kind, f.sent[0] ?? assert.fail('Missing image stream'));
      assert.equal(f.counts().aborted, true);
      assert.equal(f.usage.length, 1);
      assert.equal(f.usage[0]?.outcome, 'failed');
      assert.equal(f.usage[0]?.possiblyBilled, true);
      privacy(f.audit, f.usage);
    });
  }
