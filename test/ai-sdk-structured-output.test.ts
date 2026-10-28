import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError, generateText, NoObjectGeneratedError, Output, streamText } from 'ai';
import { z } from 'zod';
import { withAiSdkServer } from './ai-sdk-client-fixture.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';
import { probabilityChunk, probabilityStreamResponse } from './stream-logprobs-fixture.ts';

const schema = z.object({ answer: z.string() });
const output = Output.object({
  schema,
  name: 'private_structured',
  description: 'private structured schema',
});
const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'private_structured',
    description: 'private structured schema',
    strict: true,
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  },
};
const texts = {
  valid: '{"answer":"private structured value Ω"}',
  extra: '{"answer":"private structured value Ω","extra":"private extra"}',
  malformed: '{"answer":',
  mismatch: '{"answer":7}',
} as const;
function fixture(
  kind: 'openai' | 'openrouter',
  stream: boolean,
  text: string,
  gate?: NonNullable<Parameters<typeof probabilityFixture>[2]>['gate'],
) {
  return probabilityFixture(kind, undefined, {
    ...(gate === undefined ? {} : { gate }),
    reply: () => {
      const usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 };
      if (!stream)
        return Response.json({
          id: 'completion',
          created: 42,
          model: 'upstream-model',
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } },
          ],
          usage,
        });
      const halfway = Math.max(1, Math.floor(text.length / 2));
      return probabilityStreamResponse([
        probabilityChunk([
          {
            index: 0,
            delta: { role: 'assistant', content: text.slice(0, halfway) },
            finish_reason: null,
          },
        ]),
        probabilityChunk([
          { index: 0, delta: { content: text.slice(halfway) }, finish_reason: null },
        ]),
        probabilityChunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
        probabilityChunk(
          kind === 'openai' ? [] : [{ index: 0, delta: {}, finish_reason: 'stop' }],
          { usage },
        ),
        '[DONE]',
      ]);
    },
  });
}
function parsedFailure(error: unknown, text: string) {
  assert.ok(NoObjectGeneratedError.isInstance(error));
  assert.equal(error.text, text);
  assert.equal(error.finishReason, 'stop');
  assert.equal(error.usage?.totalTokens, 3);
  return true;
}
function privacy(f: ReturnType<typeof probabilityFixture>) {
  probabilityPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /private_structured|json_schema|additionalProperties|draft-07/u,
  );
}

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openai', 'openrouter'] as const)
    for (const stream of [false, true]) {
      for (const variant of ['valid', 'extra', 'malformed', 'mismatch'] as const)
        test(`AI SDK structured ${base} ${kind} stream=${stream}: ${variant} output and server accounting`, {
          timeout: 15000,
        }, async () => {
          const text = texts[variant];
          const f = fixture(kind, stream, text);
          await withAiSdkServer(f.ports, base, 'fixture-proxy-key', async (model) => {
            const options = {
              model,
              output,
              prompt: 'private prompt',
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(10000),
            };
            if (stream) {
              const result = streamText({ ...options, onError: () => {} });
              for await (const part of result.fullStream)
                if (part.type === 'error') throw part.error;
              assert.equal(await result.text, text);
              assert.equal(await result.finishReason, 'stop');
              assert.equal((await result.usage).totalTokens, 3);
              if (variant === 'valid' || variant === 'extra')
                assert.deepEqual(await result.output, { answer: 'private structured value Ω' });
              else
                await assert.rejects(Promise.resolve(result.output), (error: unknown) =>
                  parsedFailure(error, text),
                );
            } else if (variant === 'valid' || variant === 'extra') {
              const result = await generateText(options);
              assert.deepEqual(result.output, { answer: 'private structured value Ω' });
              assert.equal(result.text, text);
              assert.equal(result.usage.totalTokens, 3);
            } else
              await assert.rejects(generateText(options), (error: unknown) =>
                parsedFailure(error, text),
              );
          });
          assert.equal(f.sent.length, 1);
          assert.deepEqual(f.sent[0]?.response_format, responseFormat);
          assert.equal(f.sent[0]?.model, 'upstream-model');
          assert.deepEqual(
            f.sent[0]?.provider,
            kind === 'openrouter' ? { only: ['provider'] } : undefined,
          );
          assert.equal(f.counts().secrets, 1);
          assert.equal(f.records.length, 1);
          assert.equal(f.records[0]?.outcome, 'succeeded');
          assert.equal(f.records[0]?.possiblyBilled, true);
          assert.equal(f.records[0]?.usage.totalTokens, 3);
          privacy(f);
        });

      test(`AI SDK structured ${base} ${kind} stream=${stream}: admission and required persistence gates`, {
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
          const f = fixture(kind, stream, texts.valid, gate);
          const wire: string[] = [];
          await withAiSdkServer(
            f.ports,
            base,
            'fixture-proxy-key',
            async (model) => {
              const options = {
                model,
                output,
                prompt: 'private prompt',
                maxRetries: 0,
                abortSignal: AbortSignal.timeout(10000),
              };
              if (stream) {
                const errors: unknown[] = [];
                const result = streamText({ ...options, onError: () => {} });
                for await (const part of result.fullStream)
                  if (part.type === 'error') errors.push(part.error);
                assert.ok(errors.length > 0, gate);
                if (gate === 'audit' || gate === 'usage')
                  assert.deepEqual(await result.output, { answer: 'private structured value Ω' });
                else await assert.rejects(Promise.resolve(result.output));
              } else
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
            },
            async (response) => {
              wire.push(await response.text());
            },
          );
          assert.equal(wire.length, 1);
          assert.doesNotMatch(
            wire[0] ?? '',
            /private structured schema|private_structured|private prompt|fixture-provider-key/u,
          );
          if (stream) assert.doesNotMatch(wire[0] ?? '', /\[DONE\]|"usage"\s*:\s*\{/u);
          else assert.doesNotMatch(wire[0] ?? '', /private structured value/u);
          const attempted = gate === 'audit' || gate === 'usage';
          assert.equal(f.sent.length, attempted ? 1 : 0);
          assert.equal(f.counts().secrets, attempted ? 1 : 0);
          assert.equal(f.records.length, gate === 'audit' ? 1 : 0);
          if (gate === 'audit') {
            assert.equal(f.records[0]?.outcome, 'succeeded');
            assert.equal(f.records[0]?.usage.totalTokens, 3);
          }
          if (attempted) assert.deepEqual(f.sent[0]?.response_format, responseFormat);
          privacy(f);
        }
      });
    }

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['anthropic', 'google'] as const)
    for (const stream of [false, true])
      test(`AI SDK structured ${base} ${kind} stream=${stream}: unsupported native schemas fail before secrets`, {
        timeout: 15000,
      }, async () => {
        const f = probabilityFixture(kind);
        const wire: string[] = [];
        await withAiSdkServer(
          f.ports,
          base,
          'fixture-proxy-key',
          async (model) => {
            const options = {
              model,
              output,
              prompt: 'private prompt',
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(10000),
            };
            if (stream) {
              const errors: unknown[] = [];
              const result = streamText({ ...options, onError: () => {} });
              for await (const part of result.fullStream)
                if (part.type === 'error') errors.push(part.error);
              assert.ok(errors.length > 0);
              await assert.rejects(Promise.resolve(result.output));
            } else
              await assert.rejects(
                generateText(options),
                (error: unknown) => APICallError.isInstance(error) && error.statusCode === 502,
              );
          },
          async (response) => {
            wire.push(await response.text());
          },
        );
        assert.equal(f.sent.length, 0);
        assert.equal(f.counts().secrets, 0);
        assert.equal(f.records.length, 0);
        assert.equal(wire.length, 1);
        assert.doesNotMatch(
          wire[0] ?? '',
          /private|fixture-provider-key|\[DONE\]|"usage"\s*:\s*\{/u,
        );
        privacy(f);
      });
