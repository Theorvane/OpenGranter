import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import { createChatHandler, type PublishedModel } from '../src/gateway/chat-handler.ts';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import type { Statement } from '../src/policy/evaluate.ts';

function model(id: number): PublishedModel {
  return {
    alias: `model-${String(id).padStart(4, '0')}`,
    created: 42,
    enabled: true,
    routes: [
      {
        kind: 'managed',
        candidates: [
          { id: 'candidate', kind: 'managed', providerId: 'provider', upstreamModelId: 'upstream' },
        ],
      },
    ],
    openRouterMetadata: {
      canonical_slug: 'published/canonical',
      name: 'Published model',
      context_length: 8192,
      architecture: {
        modality: 'text->text',
        input_modalities: ['text'],
        output_modalities: ['text'],
      },
      pricing: { prompt: '0.000001', completion: '0.000002' },
      top_provider: { is_moderated: true },
      supported_parameters: ['temperature'],
      supported_voices: null,
      default_parameters: null,
      per_request_limits: null,
      links: { details: 'https://catalog.example/model' },
    },
  };
}
const allow: Statement = { effect: 'Allow', actions: ['*'], resources: ['*'] };
function fixture(
  models: readonly PublishedModel[] = Array.from({ length: 4 }, (_, id) => model(id)),
  options: { statements?: readonly Statement[]; auditFailure?: boolean } = {},
) {
  let reads = 0;
  const events: unknown[] = [];
  const handler = createChatHandler({
    newRequestId: () => 'request',
    authenticate: async () => ({
      id: 'user',
      active: true,
      credentialId: 'credential',
      policyVersions: [],
      statements: options.statements ?? [allow],
    }),
    listPublishedModels: async () => {
      reads++;
      return models;
    },
    resolveRoute: async () => assert.fail('listing routed'),
    resolveSecret: async () => assert.fail('listing read secrets'),
    checkLimit: async () => assert.fail('listing checked limits'),
    invokeDirect: async () => assert.fail('listing invoked'),
    invokeOpenRouter: async () => assert.fail('listing invoked'),
    writeUsage: async () => assert.fail('listing wrote usage'),
    writeAudit: async (event) => {
      if (options.auditFailure) throw Error('private audit');
      events.push(event);
    },
  });
  const request = (suffix = '', base = '/api/v1') =>
    new Request(`http://untrusted.example${base}/models${suffix}`, {
      headers: { authorization: 'Bearer fixture' },
    });
  return { handler, request, events, reads: () => reads };
}
test('compatible model paging returns visible slice and fixed relative continuation', async () => {
  const f = fixture();
  const response = await f.handler(f.request('?offset=1&limit=2'));
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    data: Array<{ id: string }>;
    total_count: number;
    links: { next: string | null };
  };
  assert.deepEqual(
    body.data.map((item) => item.id),
    ['model-0001', 'model-0002'],
  );
  assert.equal(body.total_count, 4);
  assert.equal(body.links.next, '/api/v1/models?offset=3&limit=2');
  assert.deepEqual(
    f.events.map((event) => (event as { count: number }).count),
    [2],
  );
});
async function socket(
  f: ReturnType<typeof fixture>,
  run: (sdk: OpenRouter, queries: string[]) => Promise<void>,
) {
  const queries: string[] = [];
  const server = createNodeRequestServer(async (request) => {
    queries.push(new URL(request.url).search);
    return f.handler(request);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(
      new OpenRouter({
        apiKey: 'fixture',
        serverURL: `http://127.0.0.1:${address.port}/api/v1`,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      }),
      queries,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
test('official SDK iterates exact page multiples through a terminal empty request', async () => {
  const f = fixture();
  await socket(f, async (sdk, queries) => {
    const ids: string[] = [];
    const counts: number[] = [];
    for await (const page of await sdk.models.list({ limit: 2 })) {
      ids.push(...page.result.data.map((item) => item.id));
      counts.push(page.result.data.length);
      assert.equal(page.result.totalCount, 4);
    }
    assert.deepEqual(ids, ['model-0000', 'model-0001', 'model-0002', 'model-0003']);
    assert.deepEqual(counts, [2, 2, 0]);
    assert.equal(queries.length, 3);
    assert.equal(new URLSearchParams(queries[2]).get('offset'), '4');
  });
});
test('official SDK handles explicit defaults, nullable offset and large no-argument listing', async () => {
  const f = fixture(Array.from({ length: 501 }, (_, id) => model(id)));
  await socket(f, async (sdk, queries) => {
    const defaults = await sdk.models.list({});
    assert.equal(defaults.result.data.length, 500);
    assert.equal(defaults.result.totalCount, 501);
    const nullable = await sdk.models.list({ offset: null, limit: 2 });
    assert.equal(nullable.result.data.length, 2);
    assert.equal(new URLSearchParams(queries[1]).has('offset'), false);
    const ids: string[] = [];
    for await (const page of await sdk.models.list())
      ids.push(...page.result.data.map((item) => item.id));
    assert.equal(ids.length, 501);
    assert.equal(new Set(ids).size, 501);
    assert.equal(queries[2], '');
    assert.equal(new URLSearchParams(queries.at(-1)).get('offset'), '501');
  });
});
test('paging offsets and counts apply after model/provider Deny and disabled filtering', async () => {
  for (const kind of ['managed', 'delegated'] as const) {
    const blocked = {
      ...model(0),
      routes: [
        {
          kind,
          candidates: [{ id: 'blocked', kind, providerId: 'blocked', upstreamModelId: 'upstream' }],
        },
      ],
    };
    const f = fixture([blocked, model(1), { ...model(2), enabled: false }, model(3), model(4)], {
      statements: [
        allow,
        { effect: 'Deny', actions: ['*'], resources: ['provider:blocked', 'model:model-0001'] },
      ],
    });
    const response = await f.handler(f.request('?offset=1&limit=1'));
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
      total_count: number;
      links: { next: null };
    };
    assert.equal(response.status, 200);
    assert.deepEqual(
      body.data.map((item) => item.id),
      ['model-0004'],
    );
    assert.equal(body.total_count, 2);
    assert.equal(body.links.next, null);
  }
});
test('bounded query defaults, far offsets, no-query full list and legacy behavior stay explicit', async () => {
  for (const [suffix, count] of [
    ['?limit=1000', 4],
    ['?offset=1', 3],
    ['?offset=9007199254740991', 0],
    ['?limit=1&offset=4', 0],
    ['', 4],
  ] as const) {
    const f = fixture();
    const response = await f.handler(f.request(suffix));
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: unknown[];
      links: { next: null };
      total_count: number;
    };
    assert.equal(body.data.length, count);
    assert.equal(body.total_count, 4);
    assert.equal(body.links.next, null);
  }
  const f = fixture();
  assert.equal((await f.handler(f.request('?limit=1', '/v1'))).status, 400);
  assert.equal(f.reads(), 0);
  const legacy = (await (await f.handler(f.request('', '/v1'))).json()) as Record<string, unknown>;
  assert.equal(Object.hasOwn(legacy, 'total_count'), false);
  assert.equal(Object.hasOwn(legacy, 'links'), false);
});
test('invalid and unknown paging queries fail before catalog reads with sanitized denial audit', async () => {
  for (const suffix of [
    '?limit=0',
    '?limit=1001',
    '?offset=-1',
    '?offset=1.5',
    '?offset=1e2',
    '?offset=01',
    '?offset=',
    '?offset=null',
    '?offset=9007199254740992',
    '?limit=2&limit=2',
    '?offset=0&offset=1',
    '?limit=%2B1',
    '?limit=1&provider=private-secret',
    '?probe=private-secret',
  ]) {
    const f = fixture();
    const response = await f.handler(f.request(suffix));
    assert.equal(response.status, 400);
    assert.equal(f.reads(), 0);
    assert.equal((f.events[0] as { kind: string }).kind, 'request-denied');
    assert.doesNotMatch(await response.text(), /private-secret/);
    assert.doesNotMatch(JSON.stringify(f.events), /private-secret/);
  }
});
test('paging keeps whole-catalog validation and required audit failure before successful output', async () => {
  const invalid = {
    ...model(9),
    enabled: false,
    openRouterMetadata: { name: 'private-secret' },
  } as unknown as PublishedModel;
  const f = fixture([model(0), invalid]);
  const response = await f.handler(f.request('?limit=1'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-secret/);
  const failed = fixture(undefined, { auditFailure: true });
  const auditResponse = await failed.handler(failed.request('?limit=1'));
  assert.equal(auditResponse.status, 503);
  assert.doesNotMatch(await auditResponse.text(), /private audit|published\/canonical/);
});

test('each SDK page reevaluates current IAM and suppresses newly denied metadata', async () => {
  const statements: Statement[] = [allow];
  const f = fixture(undefined, { statements });
  await socket(f, async (sdk) => {
    const first = await sdk.models.list({ limit: 2 });
    assert.equal(first.result.data.length, 2);
    statements.splice(0, statements.length, { effect: 'Deny', actions: ['*'], resources: ['*'] });
    const next = await first.next();
    assert.ok(next);
    assert.equal(next.result.data.length, 0);
    assert.equal(next.result.totalCount, 0);
    assert.equal(next.result.links.next, null);
    assert.deepEqual(
      f.events.map((event) => (event as { count: number }).count),
      [2, 0],
    );
  });
});
test('paging authenticates before query validation and does not read a catalog anonymously', async () => {
  const f = fixture();
  const response = await f.handler(new Request('http://localhost/api/v1/models?limit=1'));
  assert.equal(response.status, 401);
  assert.equal(f.reads(), 0);
});
