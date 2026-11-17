import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startCatalogPreview } from '../scripts/preview-management-catalog.ts';

test('preview serves synthetic scenarios without live API activation', async () => {
  const server = await startCatalogPreview(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, '127.0.0.1');
    const base = 'http://127.0.0.1:' + address.port;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy') ?? '', /connect-src/);
    const html = await page.text();
    assert.match(html, /preview/i);
    for (const scenario of ['list', 'loading', 'empty', 'error']) {
      assert.ok(html.includes('id="' + scenario + '"'));
    }
    const script = await (await fetch(base + '/preview.js')).text();
    assert.match(script, /atlas-chat/);
    assert.doesNotMatch(script, /fetch[(]|localStorage|sessionStorage|Bearer/);
    assert.match(script, /event[.]persisted/);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    const publicEntry = await (await fetch(base + '/signed-out')).text();
    assert.ok(publicEntry.includes('/entry.js'));
    assert.ok(!publicEntry.includes('/preview.js'));
    assert.equal((await fetch(base + '/api/v1/models')).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
