import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { projectAuditHistoryPage } from '../src/audit/history-http.ts';
import {
  type AuditHistoryEvent,
  createPostgresAuditHistoryReader,
} from '../src/audit/postgres-audit-history.ts';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';

const event: AuditHistoryEvent = {
  eventId: '9',
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'list',
  principalId: 'human',
  credentialId: 'proxy',
  policyVersions: [],
  details: { count: 1, prompt: 'private-content' },
};
function events(hole: number, length = 3): AuditHistoryEvent[] {
  const rows = Array.from({ length }, (_, index) => ({ ...event, eventId: String(9 - index) }));
  delete rows[hole];
  return rows;
}
function stored(rows: readonly AuditHistoryEvent[]): unknown[] {
  return rows.map((value) => ({
    event_id: value.eventId,
    occurred_at_ms: String(value.occurredAt),
    kind: value.kind,
    request_id: value.requestId,
    principal_id: value.principalId,
    credential_id: value.credentialId,
    policy_versions: value.policyVersions,
    details: value.details,
  }));
}
for (const hole of [0, 1, 2]) {
  test(`SQL audit reader rejects missing slot ${hole}, including lookahead`, async () => {
    const reader = createPostgresAuditHistoryReader({
      query: async () => ({ rows: stored(events(hole)) }),
    });
    await assert.rejects(reader({ principalId: 'human', limit: 2 }), {
      name: 'AuditHistoryUnavailable',
    });
  });
  test(`shared audit projector rejects missing slot ${hole}`, () => {
    assert.throws(
      () => projectAuditHistoryPage({ events: events(hole), nextCursor: null }, 'human', 3, null),
      { name: 'InvalidAuditHistoryQuery' },
    );
  });
}
test('all-hole results cannot masquerade as a successful empty page', async () => {
  const rows = new Array<AuditHistoryEvent>(1);
  const reader = createPostgresAuditHistoryReader({ query: async () => ({ rows }) });
  await assert.rejects(reader({ principalId: 'human', limit: 1 }), {
    name: 'AuditHistoryUnavailable',
  });
  assert.throws(
    () => projectAuditHistoryPage({ events: rows, nextCursor: null }, 'human', 1, null),
    { name: 'InvalidAuditHistoryQuery' },
  );
});
test('dense valid and genuinely empty SQL pages retain order, continuation and redaction', async () => {
  const dense = Array.from({ length: 3 }, (_, i) => ({ ...event, eventId: String(9 - i) }));
  const reader = createPostgresAuditHistoryReader({ query: async () => ({ rows: stored(dense) }) });
  const page = await reader({ principalId: 'human', limit: 2 });
  assert.deepEqual(
    page.events.map((value) => value.eventId),
    ['9', '8'],
  );
  assert.equal(page.nextCursor, '8');
  assert.deepEqual(projectAuditHistoryPage(page, 'human', 2, null), page);
  assert.equal(JSON.stringify(page).includes('private-content'), false);
  const empty = createPostgresAuditHistoryReader({ query: async () => ({ rows: [] }) });
  assert.deepEqual(await empty({ principalId: 'human', limit: 2 }), {
    events: [],
    nextCursor: null,
  });
});
function handler(rows: readonly AuditHistoryEvent[], deny = false, auditFailure = false) {
  const audit: string[] = [];
  let reads = 0;
  const unexpected = async (): Promise<never> => {
    throw new Error('unexpected provider execution');
  };
  const application = createChatHandler({
    newRequestId: () => 'read-audit',
    authenticate: async () => ({
      id: 'human',
      active: true,
      credentialId: 'proxy',
      policyVersions: [],
      statements: [
        { effect: 'Allow', actions: ['audit:Read'], resources: ['principal:human'] },
        ...(deny
          ? [{ effect: 'Deny' as const, actions: ['audit:Read'], resources: ['principal:human'] }]
          : []),
      ],
    }),
    resolveRoute: unexpected,
    checkLimit: unexpected,
    resolveSecret: unexpected,
    writeUsage: unexpected,
    invokeDirect: unexpected,
    listAudit: async () => {
      reads++;
      return { events: rows, nextCursor: null };
    },
    writeAudit: async (value) => {
      audit.push(value.kind);
      if (auditFailure) throw new Error('private audit diagnostic');
    },
  });
  return { application, audit, reads: () => reads };
}
for (const format of ['json', 'csv']) {
  test(`public ${format} audit reads fail closed without partial evidence`, async () => {
    const f = handler(events(1));
    const response = await f.application(
      new Request(`https://local.invalid/v1/audit?format=${format}`, {
        headers: { authorization: 'Bearer test-proxy' },
      }),
    );
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.equal(JSON.parse(body).error.code, 'audit_history_unavailable');
    assert.ok(!body.includes('private-content'));
    assert.ok(!body.includes('models-listed'));
    assert.deepEqual(f.audit, ['audit-history-read-unavailable']);
    assert.equal(f.reads(), 1);
  });
}
test('explicit Deny still precedes storage, and failed mandatory audit stays private', async () => {
  const denied = handler(events(0), true);
  const request = () =>
    new Request('https://local.invalid/v1/audit', {
      headers: { authorization: 'Bearer test-proxy' },
    });
  assert.equal((await denied.application(request())).status, 403);
  assert.equal(denied.reads(), 0);
  const failed = handler(events(0), false, true);
  const response = await failed.application(request());
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(JSON.parse(body).error.code, 'audit_unavailable');
  assert.ok(!body.includes('private audit diagnostic'));
});

test('real loopback HTTP rejects sparse JSON and CSV pages without disclosing evidence', async () => {
  const f = handler(events(1));
  const server = createNodeRequestServer(f.application);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    for (const format of ['json', 'csv']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/audit?format=${format}`, {
        headers: { authorization: 'Bearer test-proxy' },
      });
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.equal(JSON.parse(body).error.code, 'audit_history_unavailable');
      assert.ok(!body.includes('models-listed'));
      assert.ok(!body.includes('private-content'));
    }
    assert.deepEqual(f.audit, ['audit-history-read-unavailable', 'audit-history-read-unavailable']);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
