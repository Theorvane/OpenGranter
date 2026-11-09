import assert from 'node:assert/strict';
import test from 'node:test';
import type { SsoUsageResult } from '../src/gateway/postgres-sso-usage-history.ts';
import { createSsoUsageHistoryHandler } from '../src/gateway/sso-usage-history-http.ts';
import { encodeUsageCursor } from '../src/usage/history.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'original',
  policyVersions: [],
  requestId: 'chat-one',
  attemptId: 'one',
  modelAlias: 'chat',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 10,
  latencyMs: 1,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: false,
});
const ready = {
  state: 'ready',
  format: 'json',
  data: [row],
  hasMore: false,
  nextCursor: null,
} as const;
const cursor = encodeUsageCursor({ occurredAt: 10, attemptId: 'one' });
async function response(query: string, result: SsoUsageResult) {
  return createSsoUsageHistoryHandler({
    newRequestId: () => 'trusted',
    usage: { read: async () => result },
  })(
    new Request(`http://local/management/v1/usage${query}`, {
      headers: { authorization: 'Bearer test' },
    }),
  );
}
const cases: readonly [string, string, SsoUsageResult][] = [
  ['wrong format', '?format=csv', ready],
  [
    'wrong JSON format',
    '',
    { state: 'ready', format: 'csv', csv: 'private', hasMore: false, nextCursor: null },
  ],
  [
    'over requested limit',
    '?limit=1',
    { ...ready, data: [row, { ...row, attemptId: 'older', occurredAt: 9 }] },
  ],
  ['wrong explicit target', '?principal_id=other', ready],
  [
    'mixed principals',
    '',
    { ...ready, data: [row, { ...row, principalId: 'other', attemptId: 'older', occurredAt: 9 }] },
  ],
  ['wrong model', '?model=other', ready],
  ['wrong request', '?request_id=chat-other', ready],
  ['before range', '?from_ms=11', ready],
  ['exclusive end', '?to_ms=10', ready],
  ['duplicate row', '', { ...ready, data: [row, row] }],
  ['ascending rows', '', { ...ready, data: [{ ...row, attemptId: 'older', occurredAt: 9 }, row] }],
  ['cursor overlap', `?cursor=${cursor}`, ready],
  [
    'wrong continuation',
    '',
    {
      ...ready,
      hasMore: true,
      nextCursor: encodeUsageCursor({ occurredAt: 9, attemptId: 'older' }),
    },
  ],
  ['empty continuing page', '', { ...ready, data: [], hasMore: true, nextCursor: cursor }],
  [
    'CSV repeated cursor',
    `?format=csv&cursor=${cursor}`,
    { state: 'ready', format: 'csv', csv: 'private', hasMore: true, nextCursor: cursor },
  ],
  ['invalid ready query', '?limit=0', ready],
];
for (const [name, query, result] of cases)
  test(`ready response rejects ${name} without partial content`, async () => {
    const res = await response(query, result);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-usage-next-cursor'), null);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'internal_error');
    assert.equal(JSON.stringify(body).includes('private'), false);
  });
test('valid continuation preserves exact bytes and unknown costs', async () => {
  const res = await response('?limit=1', { ...ready, hasMore: true, nextCursor: cursor });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-usage-next-cursor'), cursor);
  const body = (await res.json()) as { data: (typeof row)[] };
  assert.equal(body.data[0]?.estimatedCost, null);
  assert.equal(body.data[0]?.usage.status, 'missing');
});
test('empty terminal page and CSV remain supported', async () => {
  assert.equal((await response('', { ...ready, data: [] })).status, 200);
  const res = await response('?format=csv', {
    state: 'ready',
    format: 'csv',
    csv: 'header',
    hasMore: false,
    nextCursor: null,
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'header');
});
