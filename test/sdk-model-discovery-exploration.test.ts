import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { unrecognized } from '@openrouter/sdk/types';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { explorationCatalog } from './model-discovery-exploration-fixture.ts';
import { discoveryFixture, discoveryPrivacy } from './model-discovery-filters-fixture.ts';

async function socket(
  f: ReturnType<typeof discoveryFixture>,
  run: (sdk: OpenRouter, openai: OpenAI, queries: URLSearchParams[]) => Promise<void>,
) {
  const queries: URLSearchParams[] = [];
  const server = createNodeRequestServer((r) => {
    queries.push(new URL(r.url).searchParams);
    return f.handler(r);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    await run(
      new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: url,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      }),
      new OpenAI({ apiKey: 'fixture-proxy-key', baseURL: url, maxRetries: 0, timeout: 3000 }),
      queries,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
}
const combined = {
  inputModalities: 'image',
  outputModalities: 'text',
  supportedParameters: 'tools',
  context: 8192,
  q: 'ATLAS',
  sort: 'newest',
  limit: 1,
} as const;
test('installed OpenRouter exploration iterator keeps all fields, stable ties and terminal pages', async () => {
  const f = discoveryFixture(explorationCatalog());
  await socket(f, async (sdk, _openai, queries) => {
    const ids: string[] = [],
      counts: number[] = [];
    for await (const page of await sdk.models.list(combined)) {
      ids.push(...page.result.data.map((m) => m.id));
      counts.push(page.result.data.length);
      assert.equal(page.result.totalCount, 2);
    }
    assert.deepEqual(ids, ['tie-first', 'tie-second']);
    assert.deepEqual(counts, [1, 1, 0]);
    assert.equal(queries.length, 3);
    for (const [i, p] of queries.entries())
      assert.deepEqual(Object.fromEntries(p), {
        offset: String(i),
        limit: '1',
        input_modalities: 'image',
        output_modalities: 'text',
        supported_parameters: 'tools',
        context: '8192',
        q: 'ATLAS',
        sort: 'newest',
      });
    assert.equal(f.reads(), 3);
    discoveryPrivacy(f);
  });
});
for (const [fields, expected] of [
  [{ inputModalities: 'file' }, ['big', 'tie-second']],
  [{ q: 'Atlas Vision' }, ['tie-first']],
  [{ q: 'LAB/ATLAS' }, ['tie-first', 'big', 'tie-second']],
  [{ sort: 'newest' }, ['big', 'zero', 'tie-first', 'tie-second', 'unknown']],
  [{ sort: 'context-high-to-low' }, ['big', 'tie-first', 'tie-second', 'zero', 'unknown']],
] as const)
  test(`installed OpenRouter scalar exploration ${JSON.stringify(fields)}`, async () => {
    const f = discoveryFixture(explorationCatalog().filter((m) => m.alias !== 'basic'));
    await socket(f, async (sdk) => {
      const page = await sdk.models.list(fields);
      assert.deepEqual(
        page.result.data.map((m) => m.id),
        expected,
      );
      assert.equal(page.result.totalCount, expected.length);
      discoveryPrivacy(f);
    });
  });
test('installed OpenAI consumes combined input/search/order and sorts basic aliases by creation', async () => {
  const f = discoveryFixture(explorationCatalog());
  await socket(f, async (_sdk, openai, queries) => {
    const page = await openai.models.list({
      query: { input_modalities: 'image', q: 'ATLAS', sort: 'context-high-to-low', limit: 1 },
    });
    assert.deepEqual(
      page.data.map((m) => m.id),
      ['tie-first'],
    );
    const all = await openai.models.list({ query: { sort: 'newest' } });
    assert.deepEqual(
      all.data.map((m) => m.id),
      ['big', 'basic', 'zero', 'tie-first', 'tie-second', 'unknown'],
    );
    const literal = await openai.models.list({ query: { q: 'BASIC', sort: 'newest' } });
    assert.deepEqual(
      literal.data.map((m) => m.id),
      ['basic'],
    );
    assert.equal(queries.length, 3);
    discoveryPrivacy(f);
  });
});
test('installed OpenRouter exploration next page rechecks current provider and model Deny', async () => {
  const f = discoveryFixture(explorationCatalog());
  await socket(f, async (sdk, _openai, queries) => {
    const page = await sdk.models.list(combined);
    assert.deepEqual(
      page.result.data.map((m) => m.id),
      ['tie-first'],
    );
    f.statements.push({
      effect: 'Deny',
      actions: ['*'],
      resources: ['provider:provider', 'model:tie-second'],
    });
    const next = await page.next();
    assert.ok(next);
    assert.deepEqual(next.result.data, []);
    assert.equal(next.result.totalCount, 0);
    assert.equal(next.result.links.next, null);
    assert.equal(queries[1]?.get('q'), 'ATLAS');
    assert.equal(queries[1]?.get('sort'), 'newest');
    assert.equal(queries[1]?.get('input_modalities'), 'image');
    discoveryPrivacy(f);
  });
});
for (const [fields, query] of [
  [{ inputModalities: 'text,image' }, { input_modalities: 'text,image' }],
  [{ inputModalities: 'all' }, { input_modalities: 'all' }],
  [{ q: ' Atlas' }, { q: ' Atlas' }],
  [{ q: 'x'.repeat(257) }, { q: 'x'.repeat(257) }],
  [{ sort: unrecognized('future-sort') }, { sort: 'future-sort' }],
] as const)
  test(`installed SDK invalid exploration rejects safely: ${JSON.stringify(fields).slice(0, 70)}`, async () => {
    const f = discoveryFixture(explorationCatalog());
    await socket(f, async (sdk, openai) => {
      await assert.rejects(() => sdk.models.list(fields));
      await assert.rejects(
        () => openai.models.list({ query }),
        (e: unknown) => {
          assert.ok(e instanceof OpenAI.APIError);
          assert.equal(e.status, 400);
          assert.doesNotMatch(e.message, /Atlas|future-sort|text,image|private/u);
          return true;
        },
      );
      assert.equal(f.reads(), 0);
      discoveryPrivacy(f);
    });
  });
