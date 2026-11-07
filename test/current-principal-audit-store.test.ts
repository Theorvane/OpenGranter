import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPostgresCurrentPrincipalAuditStore as createStore } from '../src/audit/postgres-current-principal.ts';
import type { CurrentPrincipalAuditEvent } from '../src/gateway/sso-current-principal-http.ts';

const event: CurrentPrincipalAuditEvent = {
  requestId: 'r',
  outcome: 'ready',
  principalId: 'human-1',
};

test('store projects fixed nonsecret parameters, captures query, and ignores unknown getters', async () => {
  const calls: unknown[][] = [];
  const client = {
    query: async (sql: string, params: readonly unknown[]) => {
      calls.push([sql, params]);
      return { rows: [{ event_id: '1' }] };
    },
  };
  const store = createStore(client, () => 42);
  client.query = async () => {
    throw new Error('PRIVATE replacement');
  };
  const input = {
    ...event,
    get token() {
      throw new Error('must not inspect extra');
    },
    prompt: 'private',
    policyVersions: ['private'],
  };
  await store.append(input);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[1], [42, 'r', 'ready', 'human-1']);
  assert.equal(JSON.stringify(calls).includes('private'), false);
});

for (const invalid of [
  null,
  [],
  {},
  { ...event, requestId: '' },
  { ...event, requestId: 'r\nprivate' },
  { ...event, requestId: 'r'.repeat(257) },
  { ...event, outcome: 'private' },
  { ...event, principalId: null },
  { ...event, principalId: '' },
  { ...event, principalId: 'p'.repeat(257) },
  { ...event, principalId: '\u0080' },
  { ...event, principalId: '\ud800' },
  { ...event, outcome: 'unauthenticated' },
  { ...event, outcome: 'unavailable' },
  Object.create(event),
]) {
  test(`invalid store input is rejected without SQL: ${JSON.stringify(invalid)}`, async () => {
    let calls = 0;
    const store = createStore(
      {
        query: async () => {
          calls++;
          return { rows: [{ event_id: '1' }] };
        },
      },
      () => 1,
    );
    await assert.rejects(store.append(invalid as CurrentPrincipalAuditEvent), {
      name: 'InvalidCurrentPrincipalAuditEvent',
      message: 'Invalid current principal audit event',
    });
    assert.equal(calls, 0);
  });
}
for (const acknowledgement of [
  [],
  [{ event_id: 1 }],
  [{ event_id: '0' }],
  [{ event_id: '01' }],
  [{ event_id: '-1' }],
  [{ event_id: '9223372036854775808' }],
  [{ event_id: '1'.repeat(100) }],
  [{ event_id: '1' }, { event_id: '2' }],
  [null],
]) {
  test(`invalid INSERT acknowledgement fails closed: ${JSON.stringify(acknowledgement)}`, async () => {
    const store = createStore({ query: async () => ({ rows: acknowledgement }) }, () => 1);
    await assert.rejects(store.append(event), {
      name: 'CurrentPrincipalAuditUnavailable',
      message: 'Current principal audit store unavailable',
    });
  });
}
for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid store clock fails before SQL: ${value}`, async () => {
    let calls = 0;
    const store = createStore(
      {
        query: async () => {
          calls++;
          return { rows: [{ event_id: '1' }] };
        },
      },
      () => value,
    );
    await assert.rejects(store.append(event), { name: 'CurrentPrincipalAuditUnavailable' });
    assert.equal(calls, 0);
  });
}
test('private SQL and clock exceptions never escape', async () => {
  for (const store of [
    createStore(
      {
        query: async () => {
          throw new Error('PRIVATE SQL');
        },
      },
      () => 1,
    ),
    createStore({ query: async () => ({ rows: [] }) }, () => {
      throw new Error('PRIVATE clock');
    }),
  ])
    await assert.rejects(store.append(event), {
      name: 'CurrentPrincipalAuditUnavailable',
      message: 'Current principal audit store unavailable',
    });
});
test('success and anonymous failures require confirmed bigint acknowledgement', async () => {
  const params: unknown[] = [];
  const store = createStore(
    {
      query: async (_sql, values) => {
        params.push(values);
        return { rows: [{ event_id: '9223372036854775807' }] };
      },
    },
    () => 0,
  );
  await store.append(event);
  await store.append({ requestId: 'r', outcome: 'unauthenticated', principalId: null });
  await store.append({ requestId: 'r', outcome: 'unavailable', principalId: null });
  assert.deepEqual(params, [
    [0, 'r', 'ready', 'human-1'],
    [0, 'r', 'unauthenticated', null],
    [0, 'r', 'unavailable', null],
  ]);
});
