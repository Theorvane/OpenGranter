import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { openCodeGatewayFixture } from '../scripts/opencode-gateway-fixture.ts';
import { aiSdkPrivacy, withAiSdkServer } from './ai-sdk-client-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const) {
    const route = kind === 'openrouter' ? 'delegated' : 'managed';
    const provider = kind === 'openrouter' ? 'openai' : kind;
    test(`AI SDK ${base} ${kind}: denial, limits and persistence gates remain effective`, {
      timeout: 15000,
    }, async () => {
      for (const gate of [
        'auth',
        'implicit',
        'model-deny',
        'provider-deny',
        'limit',
        'selection',
        'audit',
        'usage',
      ] as const) {
        const f = openCodeGatewayFixture(
          gate === 'model-deny' || gate === 'provider-deny' ? gate : 'text',
          route,
          provider,
        );
        const ports = { ...f.ports };
        if (gate === 'implicit')
          ports.authenticate = async () => ({
            id: 'user',
            active: true,
            credentialId: 'proxy',
            policyVersions: [],
            statements: [],
          });
        if (gate === 'limit') ports.checkLimit = async () => false;
        if (gate === 'usage')
          ports.writeUsage = async () => {
            throw Error('private storage fault');
          };
        if (gate === 'selection' || gate === 'audit')
          ports.writeAudit = async (event) => {
            if (
              gate === 'selection' ||
              event.kind === 'attempt' ||
              event.kind === 'delegated-attempt'
            )
              throw Error('private storage fault');
            await f.ports.writeAudit(event);
          };
        let executed = 0;
        const wire: string[] = [];
        await withAiSdkServer(
          ports,
          base,
          gate === 'auth' ? 'invalid-fixture-token' : 'fixture-proxy-token',
          async (model) => {
            const errors: unknown[] = [];
            const result = streamText({
              model,
              prompt: 'private prompt',
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(10000),
              onError: () => {},
              tools: {
                read: tool({
                  inputSchema: z.object({ filePath: z.string() }),
                  execute: async () => {
                    executed++;
                    return 'fixture-tool-result';
                  },
                }),
              },
            });
            for await (const part of result.fullStream) {
              if (part.type === 'error') errors.push(part.error);
            }
            assert.ok(errors.length > 0, gate);
            if (gate !== 'audit' && gate !== 'usage') {
              const error = errors[0];
              assert.ok(APICallError.isInstance(error));
              assert.equal(
                error.statusCode,
                gate === 'auth' ? 401 : gate === 'limit' ? 429 : gate === 'selection' ? 503 : 403,
              );
            }
            assert.doesNotMatch(
              JSON.stringify(errors),
              /private storage fault|fixture-upstream-key/u,
            );
          },
          async (response) => {
            wire.push(await response.text());
          },
        );
        assert.equal(wire.length, 1);
        assert.doesNotMatch(wire.join(''), /\[DONE\]|"usage"\s*:/u);
        assert.equal(executed, 0);
        assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
        aiSdkPrivacy(f.audit, f.usage);
      }
    });
    test(`AI SDK ${base} ${kind}: a fresh follow-up Deny stops the tool loop`, {
      timeout: 15000,
    }, async () => {
      const f = openCodeGatewayFixture('followup-deny', route, provider);
      let executed = 0;
      await withAiSdkServer(f.ports, base, 'fixture-proxy-token', async (model) => {
        const result = streamText({
          model,
          prompt: 'private prompt',
          maxRetries: 0,
          stopWhen: stepCountIs(2),
          abortSignal: AbortSignal.timeout(10000),
          onError: () => {},
          tools: {
            read: tool({
              inputSchema: z.object({ filePath: z.literal('fixture.txt') }),
              execute: async () => {
                executed++;
                return 'fixture-tool-result';
              },
            }),
          },
        });
        const errors: unknown[] = [];
        for await (const part of result.fullStream)
          if (part.type === 'error') errors.push(part.error);
        assert.equal(errors.length, 1);
        assert.ok(APICallError.isInstance(errors[0]));
        assert.equal(errors[0].statusCode, 403);
      });
      assert.equal(executed, 1);
      assert.equal(f.counts().authenticated, 2);
      assert.equal(f.counts().secrets, 1);
      assert.equal(f.sent.length, 1);
      assert.equal(f.usage.length, 1);
      assert.equal(f.usage[0]?.outcome, 'succeeded');
      aiSdkPrivacy(f.audit, f.usage);
    });
    test(`AI SDK ${base} ${kind}: abort after content records interruption without final usage`, {
      timeout: 15000,
    }, async () => {
      const f = openCodeGatewayFixture('cancel', route, provider);
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
            prompt: 'private prompt',
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
      assert.equal(f.counts().aborted, true);
      assert.equal(f.usage[0]?.outcome, 'failed');
      assert.equal(f.usage[0]?.possiblyBilled, true);
      aiSdkPrivacy(f.audit, f.usage);
    });
  }
