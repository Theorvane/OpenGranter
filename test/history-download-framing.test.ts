import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createSsoAuditExportClient } from '../src/management/audit-client.ts';
import { createSsoUsageExportClient } from '../src/management/usage-export-client.ts';

const factories = [createSsoUsageExportClient, createSsoAuditExportClient];
const headers = { 'content-type': 'text/csv; charset=utf-8', 'x-has-more': 'false' };
for (const create of factories) {
  test(`${create.name}: identity overflow cancels a stalled producer before deadline`, async () => {
    let cancelled = false;
    const client = create(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('id\r\n😀\r\n'));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { ...headers, 'content-length': '1' } },
        ),
    );
    const alarm = AbortSignal.timeout(1000);
    try {
      const result = await Promise.race([
        client.read(),
        new Promise<never>((_, reject) =>
          alarm.addEventListener('abort', () => reject(new Error('overflow stalled')), {
            once: true,
          }),
        ),
      ]);
      assert.deepEqual(result, { state: 'unavailable' });
      assert.equal(cancelled, true);
    } finally {
      client.invalidate();
    }
  });
  test(`${create.name}: compressed metadata caps decoded rather than wire bytes`, async () => {
    // A caller port can expose decoded bytes and compressed wire metadata, like Fetch.
    const csv = 'id\r\n😀\r\n';
    const client = create(
      async () =>
        new Response(csv, {
          headers: {
            ...headers,
            'content-encoding': 'gzip',
            'content-length': String(2 * 1024 * 1024 + 100),
          },
        }),
    );
    assert.deepEqual(await client.read(), {
      state: 'ready',
      csv,
      hasMore: false,
      nextCursor: null,
    });
  });
  test(`${create.name}: native HTTP gzip and broken identity downloads`, async () => {
    let mode: 'gzip' | 'wireLarge' | 'oversize' | 'truncated' = 'gzip';
    const csv = 'id,model\r\n1,😀\r\n';
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      if (mode === 'truncated') {
        res.writeHead(200, { ...headers, 'content-length': '100' });
        res.end('id\r\n');
        return;
      }
      const wire =
        mode === 'wireLarge'
          ? gzipSync('x'.repeat(2 * 1024 * 1024), { level: 0 })
          : gzipSync(mode === 'oversize' ? 'x'.repeat(2 * 1024 * 1024 + 1) : csv);
      if (mode === 'wireLarge') assert.ok(wire.byteLength > 2 * 1024 * 1024);
      res.writeHead(200, {
        ...headers,
        'content-encoding': 'gzip',
        'content-length': String(wire.byteLength),
      });
      res.end(wire);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const client = create((path, init) => fetch(`http://127.0.0.1:${address.port}${path}`, init));
    try {
      assert.deepEqual(await client.read(), {
        state: 'ready',
        csv,
        hasMore: false,
        nextCursor: null,
      });
      mode = 'wireLarge';
      const large = await client.read();
      assert.equal(large.state, 'ready');
      if (large.state === 'ready') assert.equal(large.csv, 'x'.repeat(2 * 1024 * 1024));
      mode = 'oversize';
      assert.deepEqual(await client.read(), { state: 'unavailable' });
      mode = 'truncated';
      assert.deepEqual(await client.read(), { state: 'unavailable' });
      assert.equal(calls, 4, 'never automatically retry downloads');
    } finally {
      client.invalidate();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
