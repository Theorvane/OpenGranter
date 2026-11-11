import assert from 'node:assert/strict';
import test from 'node:test';
import { createSsoUsageClient, type UsageFilters } from '../src/management/usage-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

function row(requestId: string) {
  return buildUsageRecord({
    principalId: 'human',
    credentialId: 'historic',
    policyVersions: [],
    requestId,
    attemptId: 'a',
    modelAlias: 'chat',
    routeKind: 'managed',
    upstreamModelId: 'upstream',
    selectedCandidateId: 'candidate',
    occurredAt: 10,
    latencyMs: 1,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: false,
  });
}
const page = (requestId: string) =>
  Response.json({ object: 'list', data: [row(requestId)], has_more: false, next_cursor: null });
const csv = () =>
  new Response('request_id\r\nTrace:/A+1\r\n', {
    headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
  });

for (const kind of ['json', 'csv'] as const) {
  test(`${kind} preserves exact request ID and intersecting filters`, async () => {
    const port = async (path: string) => {
      const query = new URL(path, 'https://local.invalid').searchParams;
      assert.equal(query.get('request_id'), 'Trace:/A+1');
      assert.equal(query.get('format'), kind);
      assert.equal(query.get('model'), 'chat');
      assert.equal(query.get('principal_id'), 'human');
      return kind === 'json' ? page('Trace:/A+1') : csv();
    };
    const client = kind === 'json' ? createSsoUsageClient(port) : createSsoUsageExportClient(port);
    assert.equal(
      (
        await client.read({
          requestId: 'Trace:/A+1',
          model: 'chat',
          principalId: 'human',
        } as UsageFilters)
      ).state,
      'ready',
    );
  });
  test(`${kind} rejects invalid request IDs before transport`, async () => {
    let calls = 0;
    const port = async () => {
      calls++;
      return kind === 'json' ? page('x') : csv();
    };
    const client = kind === 'json' ? createSsoUsageClient(port) : createSsoUsageExportClient(port);
    for (const requestId of [
      '',
      ' leading',
      'trailing ',
      'x\n',
      'é',
      'x?',
      '*',
      '/a',
      'a'.repeat(257),
      42,
      null,
    ]) {
      assert.deepEqual(await client.read({ requestId } as unknown as UsageFilters), {
        state: 'invalid_query',
      });
    }
    assert.equal(calls, 0);
  });
  test(`${kind} accepts the 256-character boundary`, async () => {
    const requestId = 'A'.repeat(256);
    const port = async (path: string) => {
      assert.equal(
        new URL(path, 'https://local.invalid').searchParams.get('request_id'),
        requestId,
      );
      return kind === 'json' ? page(requestId) : csv();
    };
    const client = kind === 'json' ? createSsoUsageClient(port) : createSsoUsageExportClient(port);
    assert.equal((await client.read({ requestId } as UsageFilters)).state, 'ready');
  });
}
test('JSON withholds exact-case and unrelated request mismatches', async () => {
  for (const requestId of ['trace:/A+1', 'different']) {
    assert.deepEqual(
      await createSsoUsageClient(async () => page(requestId)).read({
        requestId: 'Trace:/A+1',
      } as UsageFilters),
      { state: 'unavailable' },
    );
  }
});
test('JSON binds validation to the original request ID during an await', async () => {
  const filters = { requestId: 'Trace:/A+1' };
  let finish!: (response: Response) => void;
  const client = createSsoUsageClient(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.read(filters as UsageFilters);
  filters.requestId = 'different';
  finish(page('different'));
  assert.deepEqual(await pending, { state: 'unavailable' });
});
