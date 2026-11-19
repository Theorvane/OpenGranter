import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const mode of ['nonstream', 'text-stream', 'function-stream'] as const) {
      const stream = mode !== 'nonstream';
      const fields = stream
        ? { stream: true, ...(mode === 'function-stream' ? { tools: probabilityTools } : {}) }
        : {};
      const label = `observed timeout ${base} ${kind} ${mode}`;
      for (const status of [408, 504])
        for (const hint of [undefined, '7'])
          test(`${label}: observed${status} hint=${hint} preserves protocol fact without advisory`, async () => {
            const f = probabilityFixture(kind, undefined, {
              stream,
              reply: () =>
                new Response('private fixture-provider-key upstream timeout', {
                  status,
                  headers: {
                    ...(hint === undefined ? {} : { 'retry-after': hint }),
                    'x-private-provider': 'private',
                  },
                }),
            });
            const response = await f.handler(f.request(base, fields));
            assert.equal(response.status, base === '/api/v1' ? status : 502);
            assert.equal(response.headers.get('content-type'), 'application/json');
            assert.equal(response.headers.get('retry-after'), null);
            assert.equal(response.headers.get('x-private-provider'), null);
            assert.deepEqual(await response.json(), {
              error: {
                code: base === '/api/v1' ? status : 'upstream_failed',
                message: 'Upstream model request failed.',
                ...(base === '/api/v1'
                  ? { metadata: { opengranter_code: 'upstream_failed', error_type: 'unmapped' } }
                  : {}),
              },
              request_id: 'req-probabilities',
            });
            assert.equal(response.headers.get('x-request-id'), 'req-probabilities');
            assert.equal(f.sent.length, 1);
            assert.equal(f.counts().secrets, 1);
            assert.equal(f.records.length, 1);
            assert.equal(f.records[0]?.outcome, 'failed');
            assert.equal(f.records[0]?.usage.status, 'missing');
            assert.equal(f.records[0]?.possiblyBilled, true);
            probabilityPrivacy(f);
            assert.doesNotMatch(
              JSON.stringify([f.records, f.audits]),
              /upstreamStatus|retryAfter|retry-after/u,
            );
          });

      test(`${label}: denial and persistence failures never inherit timeout status`, async () => {
        for (const gate of [
          'auth',
          'implicit',
          'model',
          'provider',
          'limit',
          'selection',
          'usage',
          'audit',
        ] as const)
          for (const status of [408, 504]) {
            const f = probabilityFixture(kind, undefined, {
              stream,
              gate,
              reply: () => new Response('private', { status, headers: { 'retry-after': '7' } }),
            });
            const response = await f.handler(f.request(base, fields));
            assert.equal(
              response.status,
              gate === 'auth'
                ? 401
                : gate === 'limit'
                  ? 429
                  : ['selection', 'usage', 'audit'].includes(gate)
                    ? 503
                    : 403,
            );
            assert.equal(response.headers.get('retry-after'), null);
            assert.doesNotMatch(await response.text(), /private|upstreamStatus|retryAfter/u);
            const attempted = gate === 'usage' || gate === 'audit';
            assert.equal(f.sent.length, attempted ? 1 : 0);
            assert.equal(f.counts().secrets, attempted ? 1 : 0);
            assert.equal(f.records.length, gate === 'audit' ? 1 : 0);
            probabilityPrivacy(f);
          }
      });

      test(`${label}: required handoffs complete before timeout response`, {
        timeout: 15000,
      }, async () => {
        const f = probabilityFixture(kind, undefined, {
          stream,
          reply: () => new Response('private', { status: 504 }),
        });
        let enterUsage = () => {},
          releaseUsage = () => {},
          enterAudit = () => {},
          releaseAudit = () => {};
        const usageEntered = new Promise<void>((r) => {
          enterUsage = r;
        });
        const usageReleased = new Promise<void>((r) => {
          releaseUsage = r;
        });
        const auditEntered = new Promise<void>((r) => {
          enterAudit = r;
        });
        const auditReleased = new Promise<void>((r) => {
          releaseAudit = r;
        });
        const handler = createChatHandler({
          ...f.ports,
          writeUsage: async (record) => {
            enterUsage();
            await usageReleased;
            await f.ports.writeUsage(record);
          },
          writeAudit: async (event) => {
            if (event.kind === 'attempt' || event.kind === 'delegated-attempt') {
              enterAudit();
              await auditReleased;
            }
            await f.ports.writeAudit(event);
          },
        });
        let settled = false;
        const pending = handler(f.request(base, fields)).then((response) => {
          settled = true;
          return response;
        });
        try {
          await usageEntered;
          assert.equal(settled, false);
          releaseUsage();
          await auditEntered;
          assert.equal(settled, false);
          releaseAudit();
          const response = await pending;
          assert.equal(response.status, base === '/api/v1' ? 504 : 502);
          assert.equal(response.headers.get('retry-after'), null);
          assert.equal(f.records.length, 1);
          probabilityPrivacy(f);
        } finally {
          releaseUsage();
          releaseAudit();
        }
      });
    }
