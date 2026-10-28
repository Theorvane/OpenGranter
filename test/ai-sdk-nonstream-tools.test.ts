import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError, generateText, stepCountIs } from 'ai';
import { withAiSdkServer } from './ai-sdk-client-fixture.ts';
import {
  assertNativeContinuation,
  nonstreamToolFixture,
  parallelLookup,
} from './ai-sdk-nonstream-tool-fixture.ts';
import { probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const) {
    test(`AI SDK ${base} ${kind}: generateText parallel function/result continuation`, {
      timeout: 15000,
    }, async () => {
      const f = nonstreamToolFixture(kind);
      const lookup = parallelLookup();
      const total = kind === 'anthropic' ? 5 : 7;
      const wire: unknown[] = [];
      await withAiSdkServer(
        f.ports,
        base,
        'fixture-proxy-key',
        async (model) => {
          const result = await generateText({
            model,
            prompt: 'private prompt',
            tools: lookup.tools,
            maxRetries: 0,
            stopWhen: stepCountIs(2),
            abortSignal: AbortSignal.timeout(10000),
          });
          assert.equal(result.text, 'private final answer');
          assert.equal(result.finishReason, 'stop');
          assert.equal(result.steps.length, 2);
          // The pinned AI SDK sums input/output counters rather than retaining reported totals.
          assert.equal(result.totalUsage.totalTokens, 10);
          assert.equal(result.steps[0]?.finishReason, 'tool-calls');
          assert.deepEqual(
            result.steps[0]?.toolCalls.map(({ toolCallId, input }) => ({ toolCallId, input })),
            [
              { toolCallId: 'call_a', input: { query: 'private one' } },
              { toolCallId: 'call_b', input: { query: 'private two' } },
            ],
          );
        },
        async (response) => {
          wire.push(await response.json());
        },
      );
      assert.equal(wire.length, 2);
      for (const value of wire) {
        assert.ok(typeof value === 'object' && value !== null && 'usage' in value);
        assert.deepEqual(value.usage, {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: total,
        });
      }
      assert.deepEqual(lookup.completed, ['private two', 'private one']);
      assert.equal(f.sent.length, 2);
      assertNativeContinuation(kind, f.sent[1] ?? assert.fail('Missing continuation'));
      assert.equal(f.records.length, 2);
      assert.equal(new Set(f.records.map((r) => r.requestId)).size, 2);
      assert.ok(f.records.every((r) => r.outcome === 'succeeded' && r.usage.totalTokens === total));
      assert.deepEqual(f.counts(), { secrets: 2, routes: 2 });
      assert.deepEqual(f.observed(), { authenticated: 2, limits: 2 });
      probabilityPrivacy(f);
    });

    test(`AI SDK ${base} ${kind}: generateText rechecks provider Deny after local tools`, {
      timeout: 15000,
    }, async () => {
      const f = nonstreamToolFixture(kind);
      const original = f.ports.authenticate;
      f.ports.authenticate = async (...args) => {
        const principal = await original(...args);
        assert.ok(principal);
        return f.sent.length
          ? {
              ...principal,
              statements: [
                ...principal.statements,
                { effect: 'Deny', actions: ['llm:UseProvider'], resources: ['provider:provider'] },
              ],
            }
          : principal;
      };
      const lookup = parallelLookup();
      await withAiSdkServer(f.ports, base, 'fixture-proxy-key', async (model) => {
        await assert.rejects(
          generateText({
            model,
            prompt: 'private prompt',
            tools: lookup.tools,
            maxRetries: 0,
            stopWhen: stepCountIs(2),
            abortSignal: AbortSignal.timeout(10000),
          }),
          (error: unknown) => APICallError.isInstance(error) && error.statusCode === 403,
        );
      });
      assert.deepEqual(lookup.completed, ['private two', 'private one']);
      assert.equal(f.sent.length, 1);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'succeeded');
      assert.deepEqual(f.counts(), { secrets: 1, routes: 2 });
      assert.deepEqual(f.observed(), { authenticated: 2, limits: 1 });
      assert.match(
        JSON.stringify(f.audits),
        kind === 'openrouter' ? /"kind":"delegated-denied"/u : /"kind":"denied"/u,
      );
      probabilityPrivacy(f);
    });

    for (const gate of [
      'auth',
      'implicit',
      'model',
      'provider',
      'limit',
      'selection',
      'audit',
      'usage',
    ] as const)
      test(`AI SDK ${base} ${kind}: generateText ${gate} gate withholds executable calls`, {
        timeout: 15000,
      }, async () => {
        const f = nonstreamToolFixture(kind, gate);
        const lookup = parallelLookup();
        await withAiSdkServer(f.ports, base, 'fixture-proxy-key', async (model) => {
          await assert.rejects(
            generateText({
              model,
              prompt: 'private prompt',
              tools: lookup.tools,
              maxRetries: 0,
              stopWhen: stepCountIs(2),
              abortSignal: AbortSignal.timeout(10000),
            }),
            (error: unknown) => {
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
              assert.doesNotMatch(
                error.responseBody ?? '',
                /private|fixture-provider-key|fixture-proxy-key/u,
              );
              return true;
            },
          );
        });
        assert.deepEqual(lookup.completed, []);
        const upstream = gate === 'audit' || gate === 'usage' ? 1 : 0;
        assert.equal(f.sent.length, upstream);
        assert.equal(f.counts().secrets, upstream);
        assert.equal(f.observed().authenticated, 1);
        assert.equal(f.records.length, gate === 'audit' ? 1 : 0);
        if (gate === 'audit') assert.equal(f.records[0]?.outcome, 'succeeded');
        probabilityPrivacy(f);
      });
  }
