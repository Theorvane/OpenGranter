import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';

function event() {
  return {
    eventId: '9007199254740993',
    occurredAt: 100,
    kind: 'models-listed',
    requestId: 'req',
    principalId: 'human',
    credentialId: 'historical',
    policyVersions: [],
    details: { count: 1, prompt: 'PRIVATE' },
    private: 'PRIVATE',
  };
}
function page(data: unknown[] = [event()]) {
  return Response.json({ object: 'list', data, has_more: false, next_cursor: null });
}
async function bundle(entry: string) {
  const javascript = await buildManagementBrowser({ root: resolve('.'), entry });
  assert.doesNotMatch(
    javascript,
    /node:|process\.env|Buffer\.|sourceMappingURL|INSERT INTO|SELECT /,
  );
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

test('canonical audit review executes real coordinator and clears data on denial', async () => {
  const module = await bundle('src/management/audit-review.ts');
  const paths: string[] = [];
  const states: string[] = [];
  let status = 200;
  let empty = false;
  const review = module.createAuditReview(
    async (path: string) => {
      paths.push(path);
      if (status !== 200) return new Response(null, { status });
      if (path.includes('format=csv'))
        return new Response('event_id\n9007199254740993\n', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      return page(empty ? [] : [event()]);
    },
    (snapshot: { state: string }) => states.push(snapshot.state),
  );
  await review.load();
  assert.equal(review.snapshot().state, 'ready');
  assert.ok(states.includes('loading'));
  assert.equal(review.snapshot().data[0].eventId, '9007199254740993');
  assert.ok(!JSON.stringify(review.snapshot()).includes('PRIVATE'));
  assert.equal(paths.length, 1);
  assert.equal((await review.exportCsv()).state, 'ready');
  assert.equal(paths.length, 2);
  empty = true;
  await review.load();
  assert.equal(review.snapshot().state, 'empty');
  status = 503;
  await review.load();
  assert.equal(review.snapshot().state, 'unavailable');
  status = 200;
  empty = false;
  await review.load();
  assert.equal(review.snapshot().state, 'ready');
  status = 403;
  await review.load();
  assert.equal(review.snapshot().state, 'denied');
  assert.deepEqual(review.snapshot().data, []);
  const count = paths.length;
  await review.load();
  assert.equal(paths.length, count);
  review.dispose();
});

test('canonical audit client rejects malformed metadata and invalid query before transport', async () => {
  const module = await bundle('src/management/audit-client.ts');
  let calls = 0;
  const client = module.createSsoAuditClient(async () => {
    calls++;
    return page([{ ...event(), eventId: '9223372036854775808' }]);
  });
  assert.equal((await client.read({ cursor: '0' })).state, 'invalid_query');
  assert.equal(calls, 0);
  assert.equal((await client.read()).state, 'unavailable');
  assert.equal(calls, 1);
});

test('canonical audit closure builds identically through symlink checkout and forbids shared entry', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'og-audit-root-'));
  try {
    const root = join(scratch, 'checkout');
    await symlink(resolve('.'), root, 'dir');
    const entry = 'src/management/audit-review.ts';
    assert.equal(
      await buildManagementBrowser({ root, entry }),
      await buildManagementBrowser({ root: resolve('.'), entry }),
    );
    await assert.rejects(
      buildManagementBrowser({ root, entry: 'src/shared/audit/history-http.ts' }),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('server compatibility exports preserve canonical audit functions and errors', async () => {
  const server = await import('../src/audit/history-http.ts');
  const shared = await import('../src/shared/audit/history-http.ts');
  const store = await import('../src/audit/postgres-gateway-audit.ts');
  const projection = await import('../src/shared/audit/event-projection.ts');
  assert.equal(server.parseAuditHistoryQuery, shared.parseAuditHistoryQuery);
  assert.equal(server.projectAuditHistoryPage, shared.projectAuditHistoryPage);
  assert.equal(server.InvalidAuditHistoryQuery, shared.InvalidAuditHistoryQuery);
  assert.equal(store.projectGatewayAuditEvent, projection.projectGatewayAuditEvent);
  assert.equal(store.InvalidGatewayAuditEvent, projection.InvalidGatewayAuditEvent);
  assert.throws(
    () => shared.parseAuditHistoryQuery(new URL('https://audit.invalid/?cursor=0')),
    server.InvalidAuditHistoryQuery,
  );
  assert.throws(() => projection.projectGatewayAuditEvent({}, 1), store.InvalidGatewayAuditEvent);
});

test('audit allowlist rejects server imports, arbitrary shared files and symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'og-audit-escape-'));
  try {
    await mkdir(join(root, 'src/management'), { recursive: true });
    await mkdir(join(root, 'src/shared/audit'), { recursive: true });
    await mkdir(join(root, 'src/audit'), { recursive: true });
    await writeFile(join(root, 'src/audit/private.ts'), 'export const secret = "PRIVATE";');
    await writeFile(
      join(root, 'src/shared/audit/arbitrary.ts'),
      'export const secret = "PRIVATE";',
    );
    await symlink(
      join(root, 'src/audit/private.ts'),
      join(root, 'src/shared/audit/event-projection.ts'),
    );
    const linked = join(root, 'checkout-link');
    await symlink(root, linked, 'dir');
    for (const target of [
      '../audit/private.ts',
      '../shared/audit/arbitrary.ts',
      '../shared/audit/event-projection.ts',
    ]) {
      await writeFile(join(root, 'src/management/entry.ts'), `export * from '${target}';`);
      for (const checkout of [root, linked]) {
        await assert.rejects(
          buildManagementBrowser({ root: checkout, entry: 'src/management/entry.ts' }),
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
