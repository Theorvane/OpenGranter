import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresOpenRouterProviderMappingResolver } from '../src/providers/postgres-openrouter-mappings.ts';
import { invokeDelegatedRoute } from '../src/routing/invoke-delegated-route.ts';

const model = 'openai/test-model';
const row = {
  provider_id: 'company-openai',
  upstream_model_id: model,
  provider_slug: 'openai',
  enabled: true,
  verified: true,
};
const unavailable = {
  name: 'OpenRouterProviderMappingUnavailable',
  message: 'OpenRouter provider mapping unavailable',
};
async function fixture() {
  const db = new PGlite();
  await db.exec(
    await readFile(
      new URL('../migrations/009_openrouter_provider_mappings.sql', import.meta.url),
      'utf8',
    ),
  );
  const insert = (
    provider: string,
    modelId: string,
    slug: string,
    enabled = true,
    verified = true,
  ) =>
    db.query('INSERT INTO openrouter_provider_mappings VALUES ($1, $2, $3, $4, $5)', [
      provider,
      modelId,
      slug,
      enabled,
      verified,
    ]);
  const resolve = createPostgresOpenRouterProviderMappingResolver({
    query: (sql, params) => db.query(sql, [...params]),
  });
  return { db, insert, resolve };
}

test('exact enabled verified pairs resolve and next lookup observes disablement', async () => {
  const { db, insert, resolve } = await fixture();
  try {
    await insert('company-openai', model, 'openai');
    await insert('disabled', model, 'azure', false);
    await insert('unverified', model, 'anthropic', true, false);
    await insert('other-model', 'google/test-model', 'google');
    assert.equal(await resolve('company-openai', model), 'openai');
    for (const provider of ['missing', 'disabled', 'unverified', 'other-model'])
      assert.equal(await resolve(provider, model), undefined);
    assert.equal(await resolve('company-openai', 'google/test-model'), undefined);
    await db.exec(
      "UPDATE openrouter_provider_mappings SET enabled = false WHERE provider_id = 'company-openai'",
    );
    assert.equal(await resolve('company-openai', model), undefined);
  } finally {
    await db.close();
  }
});

test('schema rejects active verified destination collisions but allows inactive staging and different models', async () => {
  const { db, insert } = await fixture();
  try {
    await insert('p1', model, 'openai');
    await assert.rejects(insert('p2', model, 'openai'));
    await insert('p2', model, 'openai', false);
    await assert.rejects(
      db.exec("UPDATE openrouter_provider_mappings SET enabled = true WHERE provider_id = 'p2'"),
    );
    await insert('p3', model, 'openai', true, false);
    await assert.rejects(
      db.exec("UPDATE openrouter_provider_mappings SET verified = true WHERE provider_id = 'p3'"),
    );
    await insert('p4', 'openai/other-model', 'openai');
    await assert.rejects(insert('p1', model, 'azure'));
  } finally {
    await db.close();
  }
});

test('lookup binds hostile-looking provider IDs literally and returns only the slug', async () => {
  const { db, insert, resolve } = await fixture();
  try {
    const provider = "p'; DROP TABLE openrouter_provider_mappings; --";
    await insert(provider, model, 'azure');
    assert.equal(await resolve(provider, model), 'azure');
    assert.equal((await db.query('SELECT * FROM openrouter_provider_mappings')).rows.length, 1);
  } finally {
    await db.close();
  }
  let observed: readonly unknown[] = [];
  const lookup = createPostgresOpenRouterProviderMappingResolver({
    query: async (sql, params) => {
      observed = params;
      assert.ok(sql.includes('provider_id = $1'));
      assert.ok(sql.includes('upstream_model_id = $2'));
      return { rows: [{ ...row, credential: 'private-fixture', prompt: 'private-content' }] };
    },
  });
  assert.equal(await lookup('company-openai', model), 'openai');
  assert.deepEqual(observed, ['company-openai', model]);
});

test('malformed, duplicate, inactive, unverified and wrong-scope rows fail closed', async () => {
  for (const rows of [
    [null],
    [[]],
    [{}],
    [row, row],
    [{ ...row, provider_id: 'other' }],
    [{ ...row, upstream_model_id: 'other/model' }],
    [{ ...row, enabled: false }],
    [{ ...row, verified: false }],
    [{ ...row, verified: 'true' }],
    [{ ...row, provider_slug: '' }],
    [{ ...row, provider_slug: 'bad slug' }],
    [{ ...row, provider_slug: 'x'.repeat(257) }],
  ]) {
    await assert.rejects(
      createPostgresOpenRouterProviderMappingResolver({ query: async () => ({ rows }) })(
        'company-openai',
        model,
      ),
      unavailable,
    );
  }
});

test('invalid requested IDs reject before SQL and driver failures reveal no private cause', async () => {
  let calls = 0;
  const resolve = createPostgresOpenRouterProviderMappingResolver({
    query: async () => {
      calls++;
      return { rows: [] };
    },
  });
  for (const [provider, modelId] of [
    ['', model],
    ['x'.repeat(257), model],
    ['company-openai', ''],
    ['company-openai', 'bad model'],
    ['company-openai', 'x'.repeat(257)],
    [null, model],
  ])
    await assert.rejects(resolve(provider as string, modelId as string), {
      name: 'InvalidOpenRouterMappingLookup',
    });
  assert.equal(calls, 0);
  await assert.rejects(
    createPostgresOpenRouterProviderMappingResolver({
      query: async () => {
        throw new Error('private-driver-secret');
      },
    })('company-openai', model),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, unavailable.name);
      assert.equal(error.message, unavailable.message);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('delegated IAM filtering precedes persisted lookup and missing mappings stop inference', async () => {
  const { db, insert, resolve } = await fixture();
  try {
    await insert('company-openai', model, 'openai');
    await insert('denied-provider', model, 'azure');
    const lookups: string[] = [];
    const events: unknown[] = [];
    let calls = 0;
    let limits = 0;
    const input = {
      principalActive: true,
      principalId: 'user-1',
      credentialId: 'credential-1',
      policyVersions: [],
      modelAlias: 'chat',
      requestId: 'request-1',
      routeVersion: 'v1',
      credentialRef: 'secret/openrouter',
      request: { model: 'chat', messages: [{ role: 'user' as const, content: 'fixture' }] },
      candidates: ['company-openai', 'denied-provider'].map((providerId) => ({
        id: providerId,
        kind: 'delegated' as const,
        providerId,
        upstreamModelId: model,
      })),
      statements: [
        {
          effect: 'Allow' as const,
          actions: ['llm:InvokeModel', 'llm:UseProvider'],
          resources: ['*'],
        },
        {
          effect: 'Deny' as const,
          actions: ['llm:UseProvider'],
          resources: ['provider:denied-provider'],
        },
      ],
      ports: {
        resolveVerifiedProviderSlug: async (provider: string, modelId: string) => {
          lookups.push(provider);
          return resolve(provider, modelId);
        },
        checkLimit: async () => {
          limits++;
          return true;
        },
        writeAudit: async (event: unknown) => {
          events.push(event);
        },
        writeUsage: async () => {},
        now: () => 1000,
        invokeOpenRouter: async (_ref: string, attempt: unknown) => {
          calls++;
          assert.deepEqual(attempt, {
            upstreamModelId: model,
            authorizedProviderSlugs: ['openai'],
          });
          return { id: 'completion' };
        },
      },
    };
    assert.equal((await invokeDelegatedRoute(input)).status, 'invoked');
    assert.deepEqual(lookups, ['company-openai']);
    assert.equal(calls, 1);
    assert.equal(limits, 1);
    await db.exec(
      "UPDATE openrouter_provider_mappings SET verified = false WHERE provider_id = 'company-openai'",
    );
    assert.deepEqual(await invokeDelegatedRoute(input), {
      status: 'denied',
      reason: 'mapping-unavailable',
    });
    assert.equal(calls, 1);
    assert.equal(limits, 1);
    assert.deepEqual(events.at(-1), {
      principalId: 'user-1',
      credentialId: 'credential-1',
      policyVersions: [],
      requestId: 'request-1',
      routeVersion: 'v1',
      modelAlias: 'chat',
      kind: 'delegated-denied',
      reason: 'mapping-unavailable',
    });
  } finally {
    await db.close();
  }
});
