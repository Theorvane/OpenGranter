import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import {
  InvalidGatewayAuditEvent as PublicInvalidGatewayAuditEvent,
  projectGatewayAuditEvent as publicProjectGatewayAuditEvent,
} from '../src/audit/gateway-event-projection.ts';
import {
  InvalidGatewayAuditEvent,
  projectGatewayAuditEvent,
} from '../src/audit/postgres-gateway-audit.ts';

async function compiled(entry: string) {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    write: false,
    metafile: true,
  });
  assert.deepEqual(
    Object.keys(result.metafile.inputs).filter((path) => /\/postgres-[^/]+\.ts$/u.test(path)),
    [],
    'browser audit closure must not publish PostgreSQL runtime modules',
  );
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  assert.equal(source.includes('INSERT INTO gateway_audit_events'), false);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const event = {
  eventId: '9',
  occurredAt: 100,
  kind: 'models-listed',
  requestId: 'trace:One',
  principalId: 'alice',
  credentialId: 'credential-one',
  policyVersions: [],
  details: { count: 1 },
};

test('compiled audit JSON and page CSV retain exact request isolation without SQL publication', async () => {
  const json = await compiled('src/management/audit-client.ts');
  const csv = await compiled('src/management/audit-export-client.ts');
  const paths: string[] = [];
  const request = async (path: string) => {
    paths.push(path);
    return Response.json({ object: 'list', data: [event], has_more: false, next_cursor: null });
  };
  const filters = { principalId: 'alice', requestId: 'trace:One', limit: 1 };
  const result = await json.createAuditHistoryClient(request).read(filters);
  assert.equal(result.state, 'ready');
  const exported = await csv.createAuditPageExportClient(request).read(filters);
  assert.equal(exported.state, 'ready');
  assert.match(exported.csv, /trace:One/u);
  assert.equal(exported.hasMore, false);
  assert.equal(paths.length, 2);
  for (const path of paths) {
    const query = new URL(path, 'https://example.invalid').searchParams;
    assert.equal(query.get('request_id'), 'trace:One');
    assert.equal(query.get('principal_id'), 'alice');
  }
  const wrong = async () =>
    Response.json({
      object: 'list',
      data: [{ ...event, requestId: 'trace:one' }],
      has_more: false,
      next_cursor: null,
    });
  assert.equal((await json.createAuditHistoryClient(wrong).read(filters)).state, 'unavailable');
  assert.equal((await csv.createAuditPageExportClient(wrong).read(filters)).state, 'unavailable');
});

test('server event projection keeps its public error identity', () => {
  assert.equal(InvalidGatewayAuditEvent, PublicInvalidGatewayAuditEvent);
  assert.equal(projectGatewayAuditEvent, publicProjectGatewayAuditEvent);
  assert.throws(() => projectGatewayAuditEvent({}, 100), InvalidGatewayAuditEvent);
});
