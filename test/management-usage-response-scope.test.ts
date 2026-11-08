import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { createManagementUsageClient, type UsageFilters } from '../src/management/usage-client.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

const artifact = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      await buildManagementBrowser({
        root: process.cwd(),
        entry: 'src/management/usage-client.ts',
      }),
    ).toString('base64')
);
for (const [kind, createClient] of [
  ['source', createManagementUsageClient],
  ['artifact', artifact.createManagementUsageClient as typeof createManagementUsageClient],
] as const) {
  const row = buildUsageRecord({
    principalId: 'human',
    credentialId: 'credential',
    policyVersions: [],
    requestId: 'chat',
    attemptId: 'attempt',
    modelAlias: 'team/chat',
    routeKind: 'managed',
    upstreamModelId: 'private-model',
    selectedCandidateId: 'candidate',
    occurredAt: 10,
    latencyMs: 1,
    outcome: 'succeeded',
    possiblyBilled: true,
    possibleDuplicate: true,
  });
  function page(records: readonly unknown[]) {
    return Response.json({ object: 'list', data: records, has_more: false, next_cursor: null });
  }
  const scope = {
    principalId: 'human',
    model: 'team/chat',
    requestId: 'chat',
    fromMs: 10,
    toMs: 11,
  };
  for (const [name, filters, replacement] of [
    ['principal', { principalId: 'human' }, { principalId: 'foreign' }],
    ['model', { model: 'team/chat' }, { modelAlias: 'team/Chat' }],
    ['lower time', { fromMs: 10 }, { occurredAt: 9 }],
    ['upper time', { toMs: 11 }, { occurredAt: 11 }],
    ['request', { requestId: 'chat' }, { requestId: 'other-chat' }],
    ['combined', scope, { principalId: 'foreign' }],
  ] as const) {
    test(`${kind}: usage JSON refuses entire page on explicit ${name} scope mismatch`, async () => {
      const bad = { ...row, ...replacement, attemptId: 'other-attempt' };
      for (const records of [[bad], [row, bad]]) {
        const client = createClient(async () => page(records));
        assert.deepEqual(await client.list(filters), { state: 'unavailable' });
      }
    });
  }

  test(
    kind +
      ': exact filter intersection preserves half-open boundaries, unknowns and opaque pagination',
    async () => {
      const cursor = 'opaque_-';
      const client = createClient(async (path) => {
        const params = new URL(path, 'http://local').searchParams;
        assert.equal(params.get('principal_id'), 'human');
        assert.equal(params.get('model'), 'team/chat');
        assert.equal(params.get('cursor'), cursor);
        return page([row]);
      });
      const result = await client.list({ ...scope, cursor });
      assert.deepEqual(result, {
        state: 'ready',
        data: { records: [row], hasMore: false, nextCursor: null },
      });
      if (result.state !== 'ready') throw Error('no ready page');
      assert.equal(result.data.records[0]?.usage.totalTokens, null);
      assert.equal(result.data.records[0]?.upstreamBilledCost, null);
      assert.equal(result.data.records[0]?.possibleDuplicate, true);
      assert.deepEqual(await createClient(async () => page([])).list(scope), {
        state: 'ready',
        data: { records: [], hasMore: false, nextCursor: null },
      });
      assert.equal(
        (
          await createClient(async () => page([{ ...row, occurredAt: 10 }])).list({
            fromMs: 0,
            toMs: 11,
          })
        ).state,
        'ready',
      );
    },
  );

  test(
    kind + ': omitted filters do not invent browser identity or discard valid records',
    async () => {
      const foreign = { ...row, principalId: 'other', modelAlias: 'other/model', occurredAt: 0 };
      assert.deepEqual(await createClient(async () => page([foreign])).list(), {
        state: 'ready',
        data: { records: [foreign], hasMore: false, nextCursor: null },
      });
    },
  );

  for (const alter of ['widen', 'narrow'] as const) {
    test(`${kind}: usage scope is snapshotted before async response: caller ${alter}`, async () => {
      let deliver: ((response: Response) => void) | undefined;
      let sent = '';
      const filters: { -readonly [K in keyof UsageFilters]: UsageFilters[K] } = { ...scope };
      const client = createClient(async (path) => {
        sent = path;
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      });
      const pending = client.list(filters);
      assert.ok(deliver);
      if (alter === 'widen') {
        delete filters.principalId;
        delete filters.model;
        delete filters.fromMs;
        delete filters.toMs;
        delete filters.requestId;
        deliver(
          page([
            {
              ...row,
              principalId: 'foreign',
              modelAlias: 'foreign',
              occurredAt: 99,
              requestId: 'chat',
            },
          ]),
        );
        assert.deepEqual(await pending, { state: 'unavailable' });
      } else {
        filters.principalId = 'foreign';
        filters.model = 'foreign';
        filters.fromMs = 99;
        filters.toMs = 100;
        filters.requestId = 'foreign';
        deliver(page([row]));
        assert.equal((await pending).state, 'ready');
      }
      const params = new URL(sent, 'http://local').searchParams;
      assert.equal(params.get('model'), 'team/chat');
      assert.equal(params.get('principal_id'), 'human');
      assert.equal(params.get('from_ms'), '10');
    });
  }
}
