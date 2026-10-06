import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  discoveryCatalog,
  discoveryFixture,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';

async function socket(
  f: ReturnType<typeof discoveryFixture>,
  run: (sdk: OpenRouter, openai: OpenAI, queries: URLSearchParams[]) => Promise<void>,
) {
  const queries: URLSearchParams[] = [];
  const server = createNodeRequestServer(async (r) => {
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
  outputModalities: 'text',
  supportedParameters: 'tools',
  context: 8192,
  limit: 1,
};
test('installed OpenRouter SDK filtered iteration retains all scalar filters and exact terminal pages', async () => {
  const f = discoveryFixture();
  await socket(f, async (sdk, _openai, queries) => {
    const ids: string[] = [],
      counts: number[] = [];
    for await (const page of await sdk.models.list(combined)) {
      ids.push(...page.result.data.map((m) => m.id));
      counts.push(page.result.data.length);
      assert.equal(page.result.totalCount, 2);
    }
    assert.deepEqual(ids, ['multi', 'large']);
    assert.deepEqual(counts, [1, 1, 0]);
    assert.equal(queries.length, 3);
    for (const [index, params] of queries.entries()) {
      assert.equal(params.get('offset'), String(index));
      assert.equal(params.get('limit'), '1');
      assert.equal(params.get('output_modalities'), 'text');
      assert.equal(params.get('supported_parameters'), 'tools');
      assert.equal(params.get('context'), '8192');
    }
    assert.equal(f.reads(), 3);
    discoveryPrivacy(f);
  });
});
for (const [fields, expected] of [
  [{ outputModalities: 'image' }, ['multi', 'large', 'image']],
  [{ supportedParameters: 'temperature' }, ['small', 'multi']],
  [{ context: 8192 }, ['multi', 'large', 'image']],
  [{ outputModalities: 'all' }, ['small', 'multi', 'unknown', 'large', 'image']],
  [{ supportedParameters: 'unknown_parameter' }, []],
] as const)
  test(`installed OpenRouter SDK accepts scalar filter ${JSON.stringify(fields)}`, async () => {
    // Rich SDK discovery still requires administrator metadata, including with all.
    const f = discoveryFixture(discoveryCatalog().filter((m) => m.alias !== 'basic'));
    await socket(f, async (sdk) => {
      const page = await sdk.models.list(fields);
      assert.deepEqual(
        page.result.data.map((m) => m.id),
        expected,
      );
      assert.equal(page.result.totalCount, expected.length);
      assert.equal(page.result.links.next, null);
      discoveryPrivacy(f);
    });
  });
test('installed OpenAI SDK consumes filtered model lists and all retains basic aliases', async () => {
  const f = discoveryFixture();
  await socket(f, async (_sdk, openai) => {
    const selected = await openai.models.list({
      query: { output_modalities: 'text', supported_parameters: 'tools', context: 8192 },
    });
    assert.deepEqual(
      selected.data.map((m) => m.id),
      ['multi', 'large'],
    );
    const all = await openai.models.list({ query: { output_modalities: 'all' } });
    assert.deepEqual(
      all.data.map((m) => m.id),
      ['small', 'multi', 'unknown', 'large', 'image', 'basic'],
    );
    discoveryPrivacy(f);
  });
});
test('installed OpenRouter SDK next page reevaluates current IAM under the same filters', async () => {
  const f = discoveryFixture();
  await socket(f, async (sdk, _openai, queries) => {
    const first = await sdk.models.list(combined);
    assert.deepEqual(
      first.result.data.map((m) => m.id),
      ['multi'],
    );
    f.statements.splice(0, f.statements.length, {
      effect: 'Deny',
      actions: ['*'],
      resources: ['*'],
    });
    const next = await first.next();
    assert.ok(next);
    assert.deepEqual(next.result.data, []);
    assert.equal(next.result.totalCount, 0);
    assert.equal(next.result.links.next, null);
    assert.equal(queries[1]?.get('context'), '8192');
    assert.equal(queries[1]?.get('supported_parameters'), 'tools');
    discoveryPrivacy(f);
  });
});
for (const [fields, query] of [
  [{ context: 0 }, { context: 0 }],
  [{ outputModalities: 'text,unknown' }, { output_modalities: 'text,unknown' }],
  [{ supportedParameters: 'tools,Temperature' }, { supported_parameters: 'tools,Temperature' }],
] as const)
  test(`installed SDK invalid bounded filters reject at the gateway: ${JSON.stringify(fields)}`, async () => {
    const f = discoveryFixture();
    await socket(f, async (sdk, openai) => {
      await assert.rejects(() => sdk.models.list(fields));
      await assert.rejects(
        () => openai.models.list({ query }),
        (e: unknown) => {
          assert.ok(e instanceof OpenAI.APIError);
          assert.equal(e.status, 400);
          assert.doesNotMatch(e.message, /private|tools,temperature|text,image/u);
          return true;
        },
      );
      assert.equal(f.reads(), 0);
      discoveryPrivacy(f);
    });
  });
for (const value of ['text,image', 'image,text'])
  test(`installed SDKs consume any-member output lists as one scalar: ${value}`, async () => {
    const f = discoveryFixture();
    await socket(f, async (sdk, openai, queries) => {
      const router = await sdk.models.list({ outputModalities: value });
      const ai = await openai.models.list({ query: { output_modalities: value } });
      const expected = ['small', 'multi', 'unknown', 'large', 'image'];
      assert.deepEqual(
        router.result.data.map((m) => m.id),
        expected,
      );
      assert.equal(router.result.totalCount, 5);
      assert.equal(router.result.links.next, null);
      assert.deepEqual(
        ai.data.map((m) => m.id),
        expected,
      );
      assert.equal(queries.length, 2);
      for (const [index, query] of queries.entries()) {
        assert.deepEqual(query.getAll('output_modalities'), [value]);
        // OpenRouter injects its paging defaults; OpenAI retains a filter-only URL.
        assert.equal(query.size, index === 0 ? 3 : 1);
        if (index === 0) {
          assert.equal(query.get('offset'), '0');
          assert.equal(query.get('limit'), '500');
        }
      }
      discoveryPrivacy(f);
    });
  });
test('installed OpenRouter output-list iteration retains conjunction and list order through terminal pages', async () => {
  const f = discoveryFixture();
  await socket(f, async (sdk, _openai, queries) => {
    const ids: string[] = [];
    for await (const page of await sdk.models.list({
      outputModalities: 'image,text',
      supportedParameters: 'tools',
      context: 8192,
      limit: 1,
    })) {
      ids.push(...page.result.data.map((m) => m.id));
      assert.equal(page.result.totalCount, 3);
    }
    assert.deepEqual(ids, ['multi', 'large', 'image']);
    assert.equal(queries.length, 4);
    for (const [index, query] of queries.entries()) {
      assert.deepEqual(query.getAll('output_modalities'), ['image,text']);
      assert.equal(query.get('supported_parameters'), 'tools');
      assert.equal(query.get('context'), '8192');
      assert.equal(query.get('offset'), String(index));
    }
    discoveryPrivacy(f);
  });
});
test('installed OpenRouter output-list continuation reevaluates current explicit Deny', async () => {
  const f = discoveryFixture();
  await socket(f, async (sdk, _openai, queries) => {
    const first = await sdk.models.list({ outputModalities: 'text,image', limit: 1 });
    assert.deepEqual(
      first.result.data.map((m) => m.id),
      ['small'],
    );
    f.statements.splice(0, f.statements.length, {
      effect: 'Deny',
      actions: ['*'],
      resources: ['*'],
    });
    const next = await first.next();
    assert.ok(next);
    assert.deepEqual(next.result.data, []);
    assert.equal(next.result.totalCount, 0);
    assert.equal(next.result.links.next, null);
    assert.deepEqual(queries[1]?.getAll('output_modalities'), ['text,image']);
    discoveryPrivacy(f);
  });
});
