import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import type { CatalogRequest } from '../src/management/catalog-client.ts';
import { exportFilteredUsageCsv } from '../src/management/usage-export.ts';

const header = '"request_id","attempt_id"\r\n';
function page(rows: string, next: string | null = null, head = header) {
  return new Response(`${head}${rows}`, {
    headers: {
      'content-type': 'text/csv',
      'x-usage-has-more': String(next !== null),
      ...(next === null ? {} : { 'x-usage-next-cursor': next }),
    },
  });
}
function options() {
  return { signal: new AbortController().signal };
}

test('real HTTP filtered export captures scope, starts at first page and joins multiline CSV without repeated headers', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    assert.ok(req.url);
    seen.push(req.url);
    res.setHeader('content-type', 'text/csv');
    const next = seen.length === 1;
    res.setHeader('x-usage-has-more', String(next));
    if (next) res.setHeader('x-usage-next-cursor', 'Opaque_A');
    res.end(header + (next ? '"r1","line\r\nbreak"\r\n' : '"r2","0.000001"\r\n'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const request: CatalogRequest = (path, init) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, init);
    const filters = { model: 'chat/a&b', fromMs: 1, toMs: 20, cursor: 'OldPage' };
    const promise = exportFilteredUsageCsv(request, filters, options());
    filters.model = 'changed';
    const result = await promise;
    assert.deepEqual(result, {
      state: 'ready',
      data: {
        csv: header + '"r1","line\r\nbreak"\r\n"r2","0.000001"\r\n',
        pages: 2,
        bytes: Buffer.byteLength(header + '"r1","line\r\nbreak"\r\n"r2","0.000001"\r\n'),
      },
    });
    const first = new URL(seen[0] ?? '', 'http://local');
    const second = new URL(seen[1] ?? '', 'http://local');
    assert.equal(first.searchParams.get('model'), 'chat/a&b');
    assert.equal(first.searchParams.has('cursor'), false);
    assert.equal(second.searchParams.get('cursor'), 'Opaque_A');
    assert.equal(second.searchParams.get('model'), 'chat/a&b');
    assert.equal(second.searchParams.get('format'), 'csv');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});

test('cycle, changed header and nonterminal empty page never return partial data', async () => {
  for (const responses of [
    [page('"a","a"\r\n', 'A'), page('"b","b"\r\n', 'A')],
    [page('"a","a"\r\n', 'A'), page('"b","b"\r\n', null, '"different"\r\n')],
    [page('', 'A')],
  ]) {
    const result = await exportFilteredUsageCsv(
      async () => {
        const response = responses.shift();
        assert.ok(response);
        return response;
      },
      {},
      options(),
    );
    assert.deepEqual(result, { state: 'unavailable' });
  }
});

test('denial on a later page discards partial CSV', async () => {
  let calls = 0;
  const result = await exportFilteredUsageCsv(
    async () =>
      ++calls === 1 ? page('"a","a"\r\n', 'A') : new Response('private', { status: 403 }),
    {},
    options(),
  );
  assert.deepEqual(result, { state: 'denied' });
  assert.equal(calls, 2);
});

test('page and UTF-8 byte bounds report limit_exceeded, never a truncated success', async () => {
  assert.deepEqual(
    await exportFilteredUsageCsv(
      async () => page('"a","a"\r\n', 'A'),
      {},
      { ...options(), maxPages: 1 },
    ),
    { state: 'limit_exceeded' },
  );
  const csv = header + '"a","한"\r\n';
  assert.deepEqual(
    await exportFilteredUsageCsv(
      async () => page('"a","한"\r\n'),
      {},
      { ...options(), maxBytes: Buffer.byteLength(csv) - 1 },
    ),
    { state: 'limit_exceeded' },
  );
});

test('invalid bounds and pre-abort never send a request', async () => {
  let calls = 0;
  const request: CatalogRequest = async () => {
    calls++;
    return page('');
  };
  for (const bad of [0, 101, NaN, 1.5])
    assert.deepEqual(await exportFilteredUsageCsv(request, {}, { ...options(), maxPages: bad }), {
      state: 'invalid_query',
    });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await exportFilteredUsageCsv(request, {}, { signal: controller.signal }), {
    state: 'cancelled',
  });
  assert.equal(calls, 0);
});

test('abort settles an uncooperative pending port and exposes no data', async () => {
  const controller = new AbortController();
  const promise = exportFilteredUsageCsv(
    () => new Promise(() => {}),
    {},
    { signal: controller.signal },
  );
  controller.abort();
  assert.deepEqual(await promise, { state: 'cancelled' });
});

test('empty terminal export succeeds with one header; optional page BOM is not duplicated', async () => {
  assert.deepEqual(await exportFilteredUsageCsv(async () => page(''), {}, options()), {
    state: 'ready',
    data: { csv: header, pages: 1, bytes: Buffer.byteLength(header) },
  });
  const pages = [page('"a","a"\r\n', 'A'), page('"b","b"\r\n', null, '\ufeff' + header)];
  const result = await exportFilteredUsageCsv(
    async () => {
      const response = pages.shift();
      assert.ok(response);
      return response;
    },
    {},
    options(),
  );
  assert.equal(result.state, 'ready');
  if (result.state === 'ready') assert.equal(result.data.csv, header + '"a","a"\r\n"b","b"\r\n');
});
