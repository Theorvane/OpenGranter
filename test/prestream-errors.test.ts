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
    for (const functions of [false, true]) {
      const label = `pre-stream ${base} ${kind} ${functions ? 'function' : 'text'}`;
      const fields = { stream: true, ...(functions ? { tools: probabilityTools } : {}) };
      for (const status of [429, 503])
        for (const hint of [undefined, '0007', '0'])
          test(`${label}: observed ${status} hint=${hint} stays at the JSON boundary`, async () => {
            let cancelled = false;
            const f = probabilityFixture(kind, undefined, {
              stream: true,
              reply: () =>
                new Response(
                  new ReadableStream({
                    cancel: () => {
                      cancelled = true;
                    },
                  }),
                  {
                    status,
                    headers: {
                      ...(hint === undefined ? {} : { 'retry-after': hint }),
                      'x-private-provider': 'private fixture-provider-key',
                    },
                  },
                ),
            });
            const response = await f.handler(f.request(base, fields));
            const expected = base === '/api/v1' ? status : 502;
            assert.equal(response.status, expected);
            assert.equal(response.headers.get('content-type'), 'application/json');
            assert.equal(
              response.headers.get('retry-after'),
              hint === undefined ? null : String(Number(hint)),
            );
            assert.equal(response.headers.get('x-private-provider'), null);
            assert.equal(response.headers.get('x-request-id'), 'req-probabilities');
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
            assert.equal(cancelled, true);
            assert.equal(f.sent.length, 1);
            assert.equal(f.counts().secrets, 1);
            assert.equal(f.records.length, 1);
            assert.equal(f.records[0]?.outcome, 'failed');
            assert.equal(f.records[0]?.possiblyBilled, true);
            assert.equal(f.records[0]?.usage.status, 'missing');
            probabilityPrivacy(f);
            assert.doesNotMatch(
              JSON.stringify([f.records, f.audits]),
              /upstreamStatus|retryAfter|retry-after/u,
            );
          });

      test(`${label}: malformed hints and unrelated statuses do not escape`, async () => {
        for (const status of [429, 503, 200, 400, 401, 402, 403, 404, 408, 500, 502, 504])
          for (const hint of [
            'private fixture-provider-key',
            'Fri, 29 Oct 2026 12:00:00 GMT',
            '7, 8',
            '-1',
            '1.5',
            '1e2',
            '9007199254740992',
            '00000000000000007',
          ]) {
            const f = probabilityFixture(kind, undefined, {
              stream: true,
              reply: () =>
                new Response('private invalid stream', {
                  status,
                  headers: { 'retry-after': hint },
                }),
            });
            const response = await f.handler(f.request(base, fields));
            assert.equal(
              response.status,
              base === '/api/v1' && (status === 429 || status === 503) ? status : 502,
            );
            assert.equal(response.headers.get('retry-after'), null);
            assert.doesNotMatch(await response.text(), /private|retryAfter|upstreamStatus/u);
            probabilityPrivacy(f);
          }
      });

      test(`${label}: admission and required handoff failures cannot inherit upstream metadata`, async () => {
        for (const gate of [
          'auth',
          'implicit',
          'model',
          'provider',
          'limit',
          'selection',
          'usage',
          'audit',
        ] as const) {
          const f = probabilityFixture(kind, undefined, {
            stream: true,
            gate,
            reply: () =>
              new Response('private provider body', {
                status: 429,
                headers: { 'retry-after': '7' },
              }),
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
          assert.doesNotMatch(await response.text(), /private|retryAfter|upstreamStatus/u);
          const attempted = gate === 'usage' || gate === 'audit';
          assert.equal(f.sent.length, attempted ? 1 : 0);
          assert.equal(f.counts().secrets, attempted ? 1 : 0);
          assert.equal(f.records.length, gate === 'audit' ? 1 : 0);
          probabilityPrivacy(f);
        }
      });

      test(`${label}: JSON status and hint await required usage and outcome audit`, {
        timeout: 15000,
      }, async () => {
        const f = probabilityFixture(kind, undefined, {
          stream: true,
          reply: () => new Response('private', { status: 503, headers: { 'retry-after': '7' } }),
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
          assert.equal(response.status, base === '/api/v1' ? 503 : 502);
          assert.equal(response.headers.get('retry-after'), '7');
          assert.equal(f.records.length, 1);
          probabilityPrivacy(f);
        } finally {
          releaseUsage();
          releaseAudit();
        }
      });
    }
