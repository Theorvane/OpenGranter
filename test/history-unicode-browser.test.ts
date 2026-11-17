import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';

for (const [entry, factory, filters] of [
  ['usage-client', 'createSsoUsageClient', { model: '\ud800' }],
  ['audit-client', 'createSsoAuditClient', { principalId: '\ud800' }],
] as const) {
  test(`canonical ${entry} bundle executes exact Unicode validation`, async () => {
    const javascript = await buildManagementBrowser({
      root: process.cwd(),
      entry: `src/management/${entry}.ts`,
    });
    assert.doesNotMatch(javascript, /node:|process\.env|localStorage|INSERT INTO/);
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    );
    let calls = 0;
    const client = module[factory](async (path: string) => {
      calls++;
      if (entry === 'usage-client')
        assert.equal(
          new URL(path, 'https://test.invalid').searchParams.get('model'),
          '한글/😀/e\u0301',
        );
      return new Response(null, { status: 403 });
    });
    assert.deepEqual(await client.read(filters), { state: 'invalid_query' });
    assert.equal(calls, 0);
    assert.deepEqual(
      await client.read(entry === 'usage-client' ? { model: '한글/😀/e\u0301' } : {}),
      { state: 'denied' },
    );
    assert.equal(calls, 1);
    client.invalidate();
  });
}

test('pure Unicode helper cannot become a browser entry', async () => {
  await assert.rejects(
    buildManagementBrowser({
      root: process.cwd(),
      entry: 'src/shared/text/well-formed-unicode.ts',
    }),
    /Management build requires local TypeScript sources/,
  );
});
