import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';

async function load(entry: string) {
  const code = await buildManagementBrowser({ root: resolve('.'), entry });
  assert.doesNotMatch(
    code,
    /node:|process\.env|INSERT INTO|SELECT |gateway_audit_events|sourceMappingURL/,
  );
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
test('supported audit browser artifact projects metadata and rejects invalid pages', async () => {
  const api = await load('src/management/audit-client.ts');
  let bad = false;
  const client = api.createManagementAuditClient(async () =>
    Response.json({
      object: 'list',
      has_more: false,
      next_cursor: null,
      data: [
        {
          eventId: '9',
          occurredAt: 1000,
          kind: 'models-listed',
          requestId: 'req',
          principalId: 'human',
          credentialId: 'credential',
          policyVersions: [],
          details: { count: bad ? -1 : 1, prompt: 'PRIVATE_PROMPT' },
          secret: 'PRIVATE_SECRET',
        },
      ],
    }),
  );
  const result = await client.list({ principalId: 'human' });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.data.events[0].details, { count: 1 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  bad = true;
  assert.deepEqual(await client.list(), { state: 'unavailable' });
  client.invalidate();
});
test('supported audit screen builds as a self-contained browser module', async () => {
  assert.equal(typeof (await load('src/management/audit-app.ts')).mountManagementAudit, 'function');
});
test('audit server and shared modules are not browser entrypoints', async () => {
  for (const entry of [
    'src/audit/history-http.ts',
    'src/audit/postgres-gateway-audit.ts',
    'src/audit/postgres-audit-history.ts',
    'src/audit/principal-reference.ts',
  ]) {
    await assert.rejects(buildManagementBrowser({ root: resolve('.'), entry }));
  }
});

test('server compatibility exports preserve shared projector and error identities', async () => {
  const server = await import('../src/audit/postgres-gateway-audit.ts');
  const shared = await import('../src/audit/event-projection.ts');
  const http = await import('../src/audit/history-http.ts');
  const publicHistory = await import('../src/audit/history-public.ts');
  assert.equal(server.projectGatewayAuditEvent, shared.projectGatewayAuditEvent);
  assert.equal(server.InvalidGatewayAuditEvent, shared.InvalidGatewayAuditEvent);
  assert.equal(http.InvalidAuditHistoryQuery, publicHistory.InvalidAuditHistoryQuery);
  assert.equal(http.parseAuditHistoryQuery, publicHistory.parseAuditHistoryQuery);
  assert.equal(http.projectAuditHistoryPage, publicHistory.projectAuditHistoryPage);
  assert.throws(() => shared.projectGatewayAuditEvent({}, 0), server.InvalidGatewayAuditEvent);
  assert.throws(
    () => publicHistory.parseAuditHistoryQuery(new URL('https://invalid/?cursor=0')),
    http.InvalidAuditHistoryQuery,
  );
});

test('audit shared files cannot expand into SQL or escape canonical dependency bounds', async () => {
  const { mkdir, mkdtemp, rm, symlink, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'og-audit-build-'));
  try {
    await mkdir(join(root, 'src/management'), { recursive: true });
    await mkdir(join(root, 'src/audit'));
    await writeFile(
      join(root, 'src/management/entry.ts'),
      "export * from '../audit/history-public.ts';",
    );
    await writeFile(
      join(root, 'src/audit/history-public.ts'),
      "export * from './postgres-gateway-audit.ts';",
    );
    await writeFile(
      join(root, 'src/audit/postgres-gateway-audit.ts'),
      'export const privateValue = 1;',
    );
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
    await rm(join(root, 'src/audit/history-public.ts'));
    await symlink(
      join(root, 'src/audit/postgres-gateway-audit.ts'),
      join(root, 'src/audit/history-public.ts'),
    );
    await assert.rejects(buildManagementBrowser({ root, entry: 'src/management/entry.ts' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
