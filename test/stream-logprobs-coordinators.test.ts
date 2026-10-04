import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatRequest } from '../src/gateway/chat-handler.ts';
import type { ChatLogprobs } from '../src/providers/chat-logprobs.ts';
import { invokeDelegatedFunctionStream } from '../src/streaming/invoke-delegated-function-stream.ts';
import { invokeDelegatedTextStream } from '../src/streaming/invoke-delegated-text-stream.ts';
import { invokeManagedFunctionStream } from '../src/streaming/invoke-managed-function-stream.ts';
import { invokeManagedTextStream } from '../src/streaming/invoke-managed-text-stream.ts';
import type { OpenRouterTextStreamPayload } from '../src/streaming/openrouter-stream-chunks.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';
import {
  probabilityFixture,
  probabilityInput,
  probabilityPrivacy,
} from './nonstream-logprobs-fixture.ts';
import { finalProbabilities, streamProbabilityFields } from './stream-logprobs-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  for (const functions of [false, true])
    for (const invalid of [false, true])
      test(`${kind} ${functions ? 'function' : 'text'} summaries exclude private terminal probabilities, invalid=${invalid}`, async () => {
        const records: UsageRecord[] = [],
          audit: unknown[] = [],
          frames: string[] = [];
        const supplied = structuredClone(finalProbabilities);
        let reads = 0;
        const invoke = async (
          _candidate: unknown,
          _request: ChatRequest,
          onDelta: (
            event: Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>,
          ) => void | Promise<void>,
        ) => {
          await onDelta({
            kind: 'delta',
            id: 'completion',
            model: 'chat',
            created: 42,
            finishReason: 'stop',
          });
          return {
            status: 'complete' as const,
            id: 'completion',
            model: 'chat',
            finishReason: 'stop' as const,
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
            get usageLogprobs(): ChatLogprobs {
              reads++;
              return invalid
                ? {
                    content: [
                      { token: 'private malformed', logprob: 0, bytes: [256], top_logprobs: [] },
                    ],
                  }
                : supplied;
            },
          };
        };
        const input = {
          principalId: 'user',
          credentialId: 'credential',
          policyVersions: [],
          principalActive: true,
          requestId: 'req-probabilities',
          routeVersion: 'v1',
          modelAlias: 'chat',
          candidates: [
            { id: 'candidate', kind, providerId: 'provider', upstreamModelId: 'upstream-model' },
          ],
          statements: [{ effect: 'Allow' as const, actions: ['*'], resources: ['*'] }],
          request: probabilityInput(streamProbabilityFields(functions ? 'function' : 'text')),
          onFrame: (frame: string) => {
            frames.push(frame);
          },
        };
        const ports = {
          checkLimit: async () => true,
          writeUsage: async (record: UsageRecord) => {
            supplied.content[0]!.token = 'changed';
            records.push(record);
          },
          writeAudit: async (event: unknown) => {
            audit.push(event);
          },
        };
        const result =
          kind === 'delegated'
            ? await (functions ? invokeDelegatedFunctionStream : invokeDelegatedTextStream)({
                ...input,
                credentialRef: 'secret/reference',
                ports: {
                  ...ports,
                  resolveVerifiedProviderSlug: async () => 'provider',
                  ...(functions
                    ? {
                        invokeOpenRouterFunctionStream: (
                          _ref: string,
                          ...args: Parameters<typeof invoke>
                        ) => invoke(...args),
                      }
                    : {
                        invokeOpenRouterTextStream: (
                          _ref: string,
                          ...args: Parameters<typeof invoke>
                        ) => invoke(...args),
                      }),
                },
              })
            : await (functions ? invokeManagedFunctionStream : invokeManagedTextStream)({
                ...input,
                ports: {
                  ...ports,
                  resolveSecret: async () => assert.fail('unexpected routing secret'),
                  invokeDirectTextStream: invoke,
                  invokeDirectFunctionStream: invoke,
                },
              });
        assert.equal(reads, 1);
        assert.equal(records.length, 1);
        assert.equal(frames.length, 1);
        assert.equal(result.status, invalid ? 'failed' : 'invoked');
        if (result.status === 'invoked') {
          assert.equal(Object.hasOwn(result.response, 'usageLogprobs'), false);
          assert.equal(Object.hasOwn(result.response, 'toolCalls'), false);
          assert.doesNotMatch(JSON.stringify(result.response), /private|logprobs|usageLogprobs/u);
          assert.deepEqual(
            JSON.parse(result.finalFrames[0]?.slice(6) ?? '{}').choices[0].logprobs,
            finalProbabilities,
          );
          assert.equal(records[0]?.outcome, 'succeeded');
          assert.equal(records[0]?.usage.totalTokens, 3);
        } else {
          assert.equal(records[0]?.outcome, 'failed');
          assert.equal(records[0]?.possiblyBilled, true);
          assert.equal(records[0]?.usage.status, 'missing');
          assert.doesNotMatch(JSON.stringify(result), /private|logprobs/u);
        }
        assert.doesNotMatch(JSON.stringify([records, audit]), /private|logprobs|usageLogprobs/u);
      });

for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
  test(`${kind}: invalid stream probability controls reject before routing or secrets`, async () => {
    for (const functions of [false, true])
      for (const fields of [
        { logprobs: 'private' },
        { top_logprobs: 0 },
        { logprobs: false, top_logprobs: 0 },
        { logprobs: true, top_logprobs: -1 },
        { logprobs: true, top_logprobs: 21 },
        { logprobs: true, top_logprobs: 1.5 },
      ]) {
        const f = probabilityFixture(kind);
        const response = await f.handler(
          f.request(
            '/api/v1',
            streamProbabilityFields(functions ? 'function' : 'text', {
              logprobs: undefined,
              top_logprobs: undefined,
              ...fields,
            }),
          ),
        );
        assert.equal(response.status, 400);
        assert.doesNotMatch(await response.text(), /private/u);
        assert.equal(f.counts().routes, 0);
        assert.equal(f.counts().secrets, 0);
        await assert.rejects(() => f.stream(functions, fields));
        assert.equal(f.counts().secrets, 0);
        probabilityPrivacy(f);
      }
  });
