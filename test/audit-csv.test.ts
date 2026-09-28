import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeAuditCsv } from '../src/audit/csv.ts';

const event = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'request-1',
  principalId: 'person-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'policy-1', version: 'v1' }],
  details: {
    count: 1,
    prompt: 'private prompt',
    providerKey: 'private key',
    token: 'private token',
  },
};
const query = { limit: 50, cursor: null, fromMs: 1000, toMs: 1001 };

test('audit CSV exports only projected attributed metadata and quotes JSON fields', () => {
  const csv = serializeAuditCsv({ events: [event], nextCursor: null }, 'person-1', query);
  assert.ok(csv.startsWith('"event_id","occurred_at_ms","kind"'));
  assert.ok(csv.includes('"8","1000","models-listed","request-1","person-1","credential-1"'));
  assert.ok(csv.includes('"{""count"":1}"'));
  assert.ok(csv.includes('"[{""id"":""policy-1"",""version"":""v1""}]"'));
  assert.ok(!csv.includes('private'));
  assert.ok(csv.endsWith('\r\n'));
});

test('audit CSV rejects invalid target, ranges, order, and cursor before returning output', () => {
  for (const events of [
    [event, { ...event, eventId: '7', principalId: 'other' }],
    [event, { ...event, eventId: '9' }],
    [{ ...event, occurredAt: 999 }],
    [{ ...event, kind: 'auth-denied' }],
  ]) {
    assert.throws(() => serializeAuditCsv({ events, nextCursor: null }, 'person-1', query));
  }
  assert.throws(() => serializeAuditCsv({ events: [event], nextCursor: '7' }, 'person-1', query));
});

test('empty audit CSV has exactly one header record', () => {
  assert.equal(
    serializeAuditCsv({ events: [], nextCursor: null }, 'person-1', query).split('\r\n').length,
    2,
  );
});
