import assert from 'node:assert/strict';
import test from 'node:test';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const) {
    for (const status of [429, 503])
      for (const hint of [undefined, '7'])
        test(`upstream status ${base} ${kind} ${status} hint=${hint}: exact compatible status and legacy isolation`, async () => {
          const f = probabilityFixture(kind, undefined, {
            reply: () =>
              new Response('private fixture-provider-key', {
                status,
                headers: {
                  ...(hint === undefined ? {} : { 'retry-after': hint }),
                  'x-private-provider': 'private fixture-provider-key',
                },
              }),
          });
          const response = await f.handler(f.request(base));
          const expected = base === '/api/v1' ? status : 502;
          assert.equal(response.status, expected);
          assert.equal(response.headers.get('retry-after'), hint ?? null);
          assert.equal(response.headers.get('x-private-provider'), null);
          assert.equal(response.headers.get('x-request-id'), 'req-probabilities');
          const body = await response.json();
          assert.ok(typeof body === 'object' && body !== null && 'error' in body);
          const error = body.error;
          assert.ok(
            typeof error === 'object' && error !== null && 'code' in error && 'message' in error,
          );
          assert.equal(error.code, base === '/api/v1' ? status : 'upstream_failed');
          assert.equal(error.message, 'Upstream model request failed.');
          if (base === '/api/v1') {
            assert.ok('metadata' in error);
            assert.deepEqual(error.metadata, {
              opengranter_code: 'upstream_failed',
              error_type: 'unmapped',
            });
          }
          assert.doesNotMatch(
            JSON.stringify(body),
            /private|fixture-provider-key|upstreamStatus|retryAfter/u,
          );
          assert.equal(f.sent.length, 1);
          assert.equal(f.counts().secrets, 1);
          assert.equal(f.records.length, 1);
          assert.equal(f.records[0]?.outcome, 'failed');
          assert.equal(f.records[0]?.possiblyBilled, true);
          assert.equal(f.records[0]?.usage.status, 'missing');
          probabilityPrivacy(f);
          assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /upstreamStatus|retryAfter/u);
        });
    test(`upstream status ${base} ${kind}: other upstream codes remain generic`, async () => {
      for (const status of [400, 401, 402, 403, 404, 408, 500, 502, 504]) {
        const f = probabilityFixture(kind, undefined, {
          reply: () =>
            new Response('private fixture-provider-key', {
              status,
              headers: { 'retry-after': '7' },
            }),
        });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('retry-after'), null);
        probabilityPrivacy(f);
      }
    });
  }
