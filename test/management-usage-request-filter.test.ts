import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoUsageClient, type UsageFilters } from '../src/management/usage-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const row = buildUsageRecord({
  principalId: 'human',
  credentialId: 'old',
  policyVersions: [],
  requestId: 'req:A+1/@x',
  attemptId: 'a',
  occurredAt: 1,
  modelAlias: 'chat',
  routeKind: 'managed',
  upstreamModelId: 'up',
  selectedCandidateId: 'c',
  latencyMs: 1,
  outcome: 'succeeded',
  possiblyBilled: true,
  possibleDuplicate: true,
});
function page(requestId = row.requestId) {
  return Response.json({
    object: 'list',
    data: [{ ...row, requestId }],
    has_more: false,
    next_cursor: null,
  });
}

test('JSON and CSV serialize exact request intersection without broadening', async () => {
  for (const kind of ['json', 'csv'] as const) {
    const request = async (path: string) => {
      const q = new URL(path, 'https://local.invalid').searchParams;
      assert.equal(q.get('request_id'), row.requestId);
      assert.equal(q.get('principal_id'), 'human');
      assert.equal(q.get('model'), 'chat');
      return kind === 'json'
        ? page()
        : new Response('request_id\r\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          });
    };
    const client =
      kind === 'json' ? createSsoUsageClient(request) : createSsoUsageExportClient(request);
    assert.equal(
      (
        await client.read({
          requestId: row.requestId,
          principalId: 'human',
          model: 'chat',
        } as UsageFilters)
      ).state,
      'ready',
    );
  }
});
test('invalid exact request identifiers never reach either transport', async () => {
  let calls = 0;
  for (const make of [createSsoUsageClient, createSsoUsageExportClient]) {
    const client = make(async () => {
      calls++;
      return page();
    });
    for (const requestId of ['', ' a', 'a b', 'a&b', 'a\n', '한글', 'a'.repeat(257)]) {
      assert.equal((await client.read({ requestId } as UsageFilters)).state, 'invalid_query');
    }
  }
  assert.equal(calls, 0);
});
test('JSON rejects cross-request rows, even when principal and model match', async () => {
  const result = await createSsoUsageClient(async () => page('other')).read({
    requestId: row.requestId,
  } as UsageFilters);
  assert.equal(result.state, 'unavailable');
});
test('JSON binds row validation to the captured request ID before awaiting', async () => {
  const filters = { requestId: row.requestId } as UsageFilters & { requestId: string };
  const client = createSsoUsageClient(async () => {
    filters.requestId = 'other';
    return page('other');
  });
  assert.equal((await client.read(filters)).state, 'unavailable');
});
