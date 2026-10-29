import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError, generateText, stepCountIs, streamText } from 'ai';
import { withAiSdkServer } from './ai-sdk-client-fixture.ts';
import {
  assertImageToolHistory,
  imageToolExecution,
  imageToolFixture,
  imageToolInput,
  imageToolPrivacy,
  noImageToolDownloads,
} from './ai-sdk-image-tool-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const stream of [false, true]) {
      const label = `AI SDK image+tools ${base} ${kind} ${stream ? 'streamText' : 'generateText'}`;
      test(`${label}: preserves image and correlated continuation`, {
        timeout: 15000,
      }, async () => {
        const f = imageToolFixture(kind, stream);
        const execution = imageToolExecution(stream);
        await withAiSdkServer(f.ports, base, f.token, async (model) => {
          const options = {
            model,
            messages: imageToolInput,
            experimental_download: noImageToolDownloads,
            tools: execution.tools,
            stopWhen: stepCountIs(2),
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(10000),
          };
          if (stream) {
            const result = streamText({ ...options, onError: () => {} });
            for await (const part of result.fullStream) if (part.type === 'error') throw part.error;
            assert.equal(await result.text, 'fixture-final-answer');
            assert.equal((await result.steps).length, 2);
            assert.equal(await result.finishReason, 'stop');
            assert.equal((await result.totalUsage).totalTokens, 10);
          } else {
            const result = await generateText(options);
            assert.equal(result.text, 'private final answer');
            assert.equal(result.steps.length, 2);
            assert.equal(result.finishReason, 'stop');
            assert.equal(result.totalUsage.totalTokens, 10);
          }
        });
        assert.deepEqual(
          execution.completed,
          stream ? ['fixture.txt'] : ['private two', 'private one'],
        );
        assert.equal(f.sent.length, 2);
        for (const [index, body] of f.sent.entries())
          assertImageToolHistory(kind, stream, body, index > 0);
        assert.equal(f.records.length, 2);
        assert.equal(new Set(f.records.map((r) => r.requestId)).size, 2);
        assert.ok(
          f.records.every(
            (r) =>
              r.outcome === 'succeeded' &&
              r.usage.totalTokens === (stream || kind === 'anthropic' ? 5 : 7),
          ),
        );
        assert.equal(f.counts().secrets, 2);
        assert.deepEqual(f.observed(), { authenticated: 2, limits: 2 });
        imageToolPrivacy(f.audits, f.records);
      });

      for (const gate of ['auth', 'implicit', 'model', 'provider', 'limit'] as const)
        test(`${label}: reevaluates ${gate} after local execution`, {
          timeout: 15000,
        }, async () => {
          const f = imageToolFixture(kind, stream);
          const original = f.ports.authenticate;
          f.ports.authenticate = async (...args) => {
            const principal = await original(...args);
            assert.ok(principal);
            if (!f.sent.length) return principal;
            if (gate === 'auth') return undefined;
            if (gate === 'limit') return principal;
            return {
              ...principal,
              statements:
                gate === 'implicit'
                  ? []
                  : [
                      ...principal.statements,
                      {
                        effect: 'Deny',
                        actions: [gate === 'model' ? 'llm:InvokeModel' : 'llm:UseProvider'],
                        resources: [gate === 'model' ? 'model:chat' : '*'],
                      },
                    ],
            };
          };
          const originalLimit = f.ports.checkLimit;
          f.ports.checkLimit = async (...args) => {
            const allowed = await originalLimit(...args);
            return gate === 'limit' && f.sent.length > 0 ? false : allowed;
          };
          const status = gate === 'auth' ? 401 : gate === 'limit' ? 429 : 403;
          const execution = imageToolExecution(stream);
          await withAiSdkServer(f.ports, base, f.token, async (model) => {
            const options = {
              model,
              messages: imageToolInput,
              experimental_download: noImageToolDownloads,
              tools: execution.tools,
              stopWhen: stepCountIs(2),
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(10000),
            };
            if (stream) {
              const errors: unknown[] = [];
              const result = streamText({ ...options, onError: () => {} });
              for await (const part of result.fullStream)
                if (part.type === 'error') errors.push(part.error);
              assert.equal(errors.length, 1);
              assert.ok(APICallError.isInstance(errors[0]));
              assert.equal(errors[0].statusCode, status);
            } else
              await assert.rejects(
                generateText(options),
                (e: unknown) => APICallError.isInstance(e) && e.statusCode === status,
              );
          });
          assert.deepEqual(
            execution.completed,
            stream ? ['fixture.txt'] : ['private two', 'private one'],
          );
          assert.equal(f.sent.length, 1);
          assertImageToolHistory(
            kind,
            stream,
            f.sent[0] ?? assert.fail('Missing initial request'),
            false,
          );
          assert.equal(f.counts().secrets, 1);
          assert.deepEqual(f.observed(), { authenticated: 2, limits: gate === 'limit' ? 2 : 1 });
          assert.equal(f.records.length, 1);
          assert.equal(f.records[0]?.outcome, 'succeeded');
          if (gate !== 'auth' && gate !== 'limit')
            assert.match(
              JSON.stringify(f.audits),
              kind === 'openrouter' ? /"kind":"delegated-denied"/u : /"kind":"denied"/u,
            );
          imageToolPrivacy(f.audits, f.records);
        });

      for (const phase of [1, 2])
        for (const failure of ['usage', 'audit'] as const)
          test(`${label}: request ${phase} ${failure} failure withholds completion acknowledgment`, {
            timeout: 15000,
          }, async () => {
            const f = imageToolFixture(kind, stream);
            const writeUsage = f.ports.writeUsage,
              writeAudit = f.ports.writeAudit;
            let writes = 0;
            f.ports.writeUsage = async (record) => {
              if (failure === 'usage' && ++writes === phase) throw Error('private storage failure');
              await writeUsage(record);
            };
            f.ports.writeAudit = async (event) => {
              if (
                failure === 'audit' &&
                (event.kind === 'attempt' || event.kind === 'delegated-attempt') &&
                ++writes === phase
              )
                throw Error('private storage failure');
              await writeAudit(event);
            };
            const execution = imageToolExecution(stream);
            const wire: string[] = [];
            await withAiSdkServer(
              f.ports,
              base,
              f.token,
              async (model) => {
                const options = {
                  model,
                  messages: imageToolInput,
                  experimental_download: noImageToolDownloads,
                  tools: execution.tools,
                  stopWhen: stepCountIs(2),
                  maxRetries: 0,
                  abortSignal: AbortSignal.timeout(10000),
                };
                if (stream) {
                  const result = streamText({ ...options, onError: () => {} });
                  const errors: unknown[] = [];
                  for await (const part of result.fullStream)
                    if (part.type === 'error') errors.push(part.error);
                  assert.ok(errors.length > 0);
                  assert.doesNotMatch(
                    JSON.stringify(errors),
                    /private storage failure|fixture-upstream-key/u,
                  );
                } else
                  await assert.rejects(generateText(options), (e: unknown) => {
                    assert.ok(APICallError.isInstance(e));
                    assert.equal(e.statusCode, 503);
                    assert.doesNotMatch(
                      e.responseBody ?? '',
                      /private|fixture-(?:proxy|provider)-key/u,
                    );
                    return true;
                  });
              },
              async (response) => {
                wire.push(await response.text());
              },
            );
            assert.equal(wire.length, phase);
            const failed = wire.at(-1) ?? assert.fail('Missing failed wire');
            assert.doesNotMatch(
              failed,
              /private storage failure|private image|private trailing|iVBOR|fixture-(?:proxy|provider|upstream)-(?:key|token)/u,
            );
            if (stream) {
              assert.match(failed, /"error"\s*:/u);
              assert.doesNotMatch(failed, /\[DONE\]|"usage"\s*:\s*\{/u);
            }
            assert.deepEqual(
              execution.completed,
              phase === 1 ? [] : stream ? ['fixture.txt'] : ['private two', 'private one'],
            );
            assert.equal(f.sent.length, phase);
            for (const [index, body] of f.sent.entries())
              assertImageToolHistory(kind, stream, body, index > 0);
            assert.equal(f.counts().secrets, phase);
            assert.deepEqual(f.observed(), { authenticated: phase, limits: phase });
            assert.equal(f.records.length, failure === 'usage' ? phase - 1 : phase);
            assert.ok(f.records.every((record) => record.outcome === 'succeeded'));
            imageToolPrivacy(f.audits, f.records);
          });
    }
