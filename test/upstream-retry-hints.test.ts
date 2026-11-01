import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ProbabilityKind,
  probabilityFixture,
  probabilityPrivacy,
} from './nonstream-logprobs-fixture.ts';

const valid = [
  ['7', '7'],
  ['0', '0'],
  ['0007', '7'],
  ['9007199254740991', '9007199254740991'],
] as const;
const invalid = [
  undefined,
  '',
  '-1',
  '+1',
  '1.5',
  '1e2',
  '7, 8',
  '7 8',
  'é',
  'NaN',
  '9007199254740992',
  '0'.repeat(17),
  'private fixture-provider-key',
  'Thu, 28 Oct 2026 12:00:00 GMT',
];
function upstreamResponse(kind: ProbabilityKind, status: number, header?: string) {
  const headers = {
    ...(header === undefined ? {} : { 'retry-after': header }),
    'x-private-provider': 'private fixture-provider-key',
  };
  if (status !== 200)
    return new Response('private upstream fixture-provider-key', { status, headers });
  if (kind === 'anthropic')
    return Response.json(
      {
        id: 'completion',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'reply' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      },
      { headers },
    );
  if (kind === 'google')
    return Response.json(
      {
        responseId: 'completion',
        candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
      },
      { headers },
    );
  return Response.json(
    {
      id: 'completion',
      created: 42,
      model: 'upstream-model',
      choices: [
        { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'reply' } },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    },
    { headers },
  );
}
function assertPrivate(f: ReturnType<typeof probabilityFixture>) {
  probabilityPrivacy(f);
  assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /retry.?after/iu);
}

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const) {
    for (const status of [429, 503]) {
      for (const [header, expected] of valid)
        test(`retry hint ${base} ${kind} upstream${status}: ${header}`, async () => {
          const f = probabilityFixture(kind, undefined, {
            reply: () => upstreamResponse(kind, status, header),
          });
          const response = await f.handler(f.request(base));
          assert.equal(response.status, base === '/api/v1' ? status : 502);
          assert.equal(response.headers.get('retry-after'), expected);
          assert.equal(response.headers.get('x-private-provider'), null);
          const body = await response.json();
          assert.ok(typeof body === 'object' && body !== null && 'error' in body);
          const error = body.error;
          assert.ok(
            typeof error === 'object' && error !== null && 'code' in error && 'message' in error,
          );
          assert.equal(error.code, base === '/api/v1' ? status : 'upstream_failed');
          assert.equal(error.message, 'Upstream model request failed.');
          assert.doesNotMatch(JSON.stringify(body), /private|retry.?after|fixture-provider-key/iu);
          assert.equal(response.headers.get('x-request-id'), 'req-probabilities');
          assert.equal(f.sent.length, 1);
          assert.equal(f.counts().secrets, 1);
          assert.equal(f.records.length, 1);
          assert.equal(f.records[0]?.outcome, 'failed');
          assert.equal(f.records[0]?.possiblyBilled, true);
          assert.equal(f.records[0]?.usage.status, 'missing');
          assertPrivate(f);
        });
      test(`retry hint ${base} ${kind} upstream${status}: invalid or missing values omitted`, async () => {
        for (const header of invalid) {
          const f = probabilityFixture(kind, undefined, {
            reply: () => upstreamResponse(kind, status, header),
          });
          const response = await f.handler(f.request(base));
          assert.equal(response.status, base === '/api/v1' ? status : 502);
          assert.equal(response.headers.get('retry-after'), null, String(header));
          assert.doesNotMatch(await response.text(), /private|fixture-provider-key/u);
          assertPrivate(f);
        }
        const f = probabilityFixture(kind, undefined, {
          reply: () => {
            const response = upstreamResponse(kind, status, '7');
            response.headers.append('retry-after', '8');
            return response;
          },
        });
        assert.equal((await f.handler(f.request(base))).headers.get('retry-after'), null);
      });
    }
    test(`retry hint ${base} ${kind}: unrelated statuses and success omit headers`, async () => {
      for (const status of [200, 400, 401, 402, 403, 404, 408, 500, 502, 504]) {
        const f = probabilityFixture(kind, undefined, {
          reply: () => upstreamResponse(kind, status, '7'),
        });
        const response = await f.handler(f.request(base));
        assert.equal(response.status, status === 200 ? 200 : 502);
        assert.equal(response.headers.get('retry-after'), null);
        assert.equal(response.headers.get('x-private-provider'), null);
        assertPrivate(f);
      }
    });
    test(`retry hint ${base} ${kind}: admission and persistence errors omit upstream hints`, async () => {
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
        const f = probabilityFixture(kind, undefined, {
          gate,
          reply: () => upstreamResponse(kind, 429, '7'),
        });
        const response = await f.handler(f.request(base));
        assert.equal(
          response.status,
          gate === 'auth'
            ? 401
            : gate === 'limit'
              ? 429
              : ['selection', 'audit', 'usage'].includes(gate)
                ? 503
                : 403,
        );
        assert.equal(response.headers.get('retry-after'), null);
        const attempted = gate === 'audit' || gate === 'usage';
        assert.equal(f.sent.length, attempted ? 1 : 0);
        assert.equal(f.counts().secrets, attempted ? 1 : 0);
        assert.equal(f.records.length, gate === 'audit' ? 1 : 0);
        if (gate === 'audit') assert.equal(f.records[0]?.outcome, 'failed');
        assert.doesNotMatch(await response.text(), /private|fixture-provider-key/u);
        assertPrivate(f);
      }
    });
  }
