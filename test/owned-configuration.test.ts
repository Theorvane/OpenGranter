import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { ApprovedConfigurationRegistry } from '../src/configuration/owned-configuration.ts';
import {
  createOwnedConfigurationHandler,
  createPostgresRfc9068OwnedConfigurationHandler,
} from '../src/configuration/owned-configuration-http.ts';
import { createOwnedConfigurationService } from '../src/configuration/owned-configuration-service.ts';
import type { MigrationTransaction } from '../src/storage/postgres-migrations.ts';
import { createSsoAccessTokenFixture } from './sso-access-token-fixture.ts';

const permissions = ['Read', 'Write', 'Import', 'Publish'].map(
  (name) => `routing:${name}Configuration`,
);
const allow = [
  { effect: 'Allow', actions: permissions, resources: ['routing-configuration:organization'] },
];
const provider = {
  id: 'openai',
  kind: 'openai' as const,
  origin: 'https://api.openai.com',
  credentialRef: 'secret:openai',
};
const mapping = {
  alias: 'chat',
  transportProviderId: 'openai',
  providerId: 'openai',
  upstreamModelId: 'gpt-fixture',
  providerSlug: null,
  verified: true as const,
};
const configuration = () => ({
  schemaVersion: 1,
  providers: [provider],
  routes: [
    {
      id: 'owned-chat',
      alias: 'chat',
      strategy: 'administrator-priority',
      candidates: [
        {
          id: 'candidate-1',
          transportProviderId: 'openai',
          providerId: 'openai',
          upstreamModelId: 'gpt-fixture',
          providerSlug: null,
          priority: 0,
        },
      ],
    },
  ],
});

async function fixture() {
  const db = new PGlite();
  for (const name of [
    '004_iam_snapshots.sql',
    '005_model_catalog.sql',
    '006_optional_managed_jev.sql',
    '007_direct_provider_registrations.sql',
    '011_sso_identity_bindings.sql',
    '015_owned_configuration.sql',
  ]) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`INSERT INTO iam_principals VALUES ('admin', 'human', true), ('unattached', 'human', true);
    INSERT INTO iam_sso_identity_bindings VALUES ('https://sso.example', 'admin', 'admin'), ('https://sso.example', 'unattached', 'unattached');
    INSERT INTO iam_policies VALUES ('configuration', 'v1', '[]');
    INSERT INTO iam_principal_policies VALUES ('admin', 'configuration');
    INSERT INTO direct_provider_registrations VALUES ('openai', 'openai', 'secret:openai', true, NULL);
    INSERT INTO catalog_models VALUES ('chat', 0, false, NULL);
    INSERT INTO catalog_routes VALUES ('legacy', 'chat', 'managed', 'legacy-v1', NULL, NULL, NULL, NULL, '[{"id":"candidate-1","kind":"managed","providerId":"openai","upstreamModelId":"gpt-fixture"}]');
    UPDATE catalog_models SET enabled = true, active_route_id = 'legacy';`);
  await db.query('UPDATE iam_policies SET statements=$1::jsonb', [JSON.stringify(allow)]);
  const connection = {
    query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]),
    transaction: <T>(callback: (tx: MigrationTransaction) => Promise<T>) =>
      db.transaction((tx) =>
        callback({
          query: (sql, params) => tx.query(sql, [...params]),
          exec: (sql) => tx.exec(sql),
        }),
      ),
  };
  let registry: ApprovedConfigurationRegistry = {
    version: 'approval-v1',
    providers: [provider],
    mappings: [mapping],
  };
  const service = createOwnedConfigurationService({
    connection,
    now: () => 1000,
    loadRegistry: async () => registry,
    verifyAccessToken: async (token) =>
      token === 'invalid' ? undefined : { issuer: 'https://sso.example', subject: token },
  });
  let request = 0;
  const call = (
    operation: 'create' | 'read' | 'publish' | 'import',
    payload: unknown,
    token = 'admin',
  ) =>
    service.execute({
      operation,
      accessToken: token,
      requestId: `request-${++request}`,
      readInput: async () => payload,
    });
  const audit = async () =>
    (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM owned_configuration_audit ORDER BY event_id',
      )
    ).rows;
  return {
    db,
    connection,
    service,
    call,
    audit,
    registry: () => registry,
    setRegistry: (next: typeof registry) => {
      registry = next;
    },
  };
}

test('authenticated authorized create/read/publish uses immutable snapshots and default-private disabled research settings', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.call('create', { configuration: configuration() }), {
      status: 201,
      body: { revision: 1 },
    });
    const read = await f.call('read', { revision: 1 });
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.configuration?.routes[0]?.research, {
      enabled: false,
      environment: 'research',
      sharePrompt: false,
    });
    assert.deepEqual(
      await f.call('publish', { revision: 1, expectedRevision: null, expectedGeneration: 0 }),
      { status: 200, body: { revision: 1, generation: 1 } },
    );
    assert.deepEqual((await f.call('read', { revision: null })).body.publication, {
      revision: 1,
      generation: 1,
    });
    assert.deepEqual(
      (await f.audit()).map((row) => row.outcome),
      ['allowed', 'allowed', 'allowed', 'allowed'],
    );
    const serialized = JSON.stringify(await f.audit());
    assert.equal(serialized.includes('secret:openai'), false);
    assert.equal(serialized.includes('gpt-fixture'), false);
  } finally {
    await f.db.close();
  }
});

test('implicit Deny, explicit Deny, inactive identity and wrong action/resource cannot read, mutate, import or publish', async () => {
  const f = await fixture();
  try {
    for (const operation of ['create', 'read', 'publish', 'import'] as const) {
      let reads = 0;
      const result = await f.service.execute({
        operation,
        accessToken: 'unattached',
        requestId: `denied-${operation}`,
        readInput: async () => {
          reads++;
          return {};
        },
      });
      assert.equal(result.status, 403);
      assert.equal(reads, 0);
    }
    for (const statements of [
      [
        ...allow,
        {
          effect: 'Deny',
          actions: ['routing:PublishConfiguration', 'routing:ImportConfiguration'],
          resources: ['*'],
        },
      ],
      [
        {
          effect: 'Allow',
          actions: ['routing:ReadConfiguration'],
          resources: ['routing-configuration:other'],
        },
      ],
      [{ effect: 'Allow', actions: ['routing:ReadConfiguration'], resources: ['*'] }],
    ]) {
      await f.db.query('UPDATE iam_policies SET statements=$1::jsonb', [
        JSON.stringify(statements),
      ]);
      assert.equal((await f.call('publish', {})).status, 403);
      assert.equal((await f.call('import', {})).status, 403);
    }
    await f.db.exec("UPDATE iam_principals SET active=false WHERE principal_id='admin'");
    assert.equal((await f.call('create', {})).status, 401);
    assert.equal((await f.call('read', {}, 'invalid')).status, 401);
    assert.equal((await f.db.query('SELECT * FROM owned_configuration_revisions')).rows.length, 0);
  } finally {
    await f.db.close();
  }
});

test('rejects duplicate identifiers, raw keys, unapproved origins/references/mappings, invalid priorities and enabled Jev', async () => {
  const f = await fixture();
  try {
    const original = configuration();
    const route = original.routes[0];
    assert.ok(route);
    const candidate = route.candidates[0];
    assert.ok(candidate);
    const invalid: unknown[] = [
      { ...original, apiKey: 'sensitive-fixture' },
      { ...original, providers: [provider, provider] },
      { ...original, providers: [{ ...provider, origin: 'https://unapproved.example' }] },
      { ...original, providers: [{ ...provider, credentialRef: 'raw-sensitive-fixture' }] },
      { ...original, routes: [route, route] },
      ...[1.5, Number.MAX_SAFE_INTEGER + 1, null, '1'].map((priority) => ({
        ...original,
        routes: [{ ...route, candidates: [{ ...candidate, priority }] }],
      })),
      { ...original, routes: [{ ...route, candidates: [candidate, candidate] }] },
      { ...original, routes: [{ ...route, candidates: [{ ...candidate, providerId: 'other' }] }] },
      {
        ...original,
        routes: [{ ...route, candidates: [{ ...candidate, upstreamModelId: 'unverified' }] }],
      },
      { ...original, routes: [{ ...route, strategy: 'fabricated-health' }] },
      {
        ...original,
        routes: [
          { ...route, research: { enabled: true, environment: 'research', sharePrompt: false } },
        ],
      },
      {
        ...original,
        routes: [
          { ...route, research: { enabled: false, environment: 'production', sharePrompt: false } },
        ],
      },
    ];
    for (const item of invalid)
      assert.equal((await f.call('create', { configuration: item })).status, 400);
    assert.equal((await f.db.query('SELECT * FROM owned_configuration_revisions')).rows.length, 0);
    assert.equal(JSON.stringify(await f.audit()).includes('sensitive-fixture'), false);
  } finally {
    await f.db.close();
  }
});

test('publication CAS races and ABA cannot overwrite; rollback revalidates current attestations', async () => {
  const f = await fixture();
  try {
    await f.call('create', { configuration: configuration() });
    await f.call('create', { configuration: configuration() });
    const race = await Promise.all(
      [1, 2].map((revision) =>
        f.call('publish', { revision, expectedRevision: null, expectedGeneration: 0 }),
      ),
    );
    assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
    const current = (await f.call('read', { revision: null })).body.publication;
    assert.ok(current);
    const other = current.revision === 1 ? 2 : 1;
    assert.equal(
      (
        await f.call('publish', {
          revision: other,
          expectedRevision: current.revision,
          expectedGeneration: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call('publish', {
          revision: current.revision,
          expectedRevision: other,
          expectedGeneration: 2,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call('publish', {
          revision: other,
          expectedRevision: current.revision,
          expectedGeneration: 1,
        })
      ).status,
      409,
    );
    f.setRegistry({ ...f.registry(), version: 'approval-v2', mappings: [] });
    assert.equal(
      (
        await f.call('publish', {
          revision: other,
          expectedRevision: current.revision,
          expectedGeneration: 3,
        })
      ).status,
      400,
    );
    assert.equal((await f.call('read', { revision: null })).body.publication?.generation, 3);
  } finally {
    await f.db.close();
  }
});

test('explicit legacy import creates draft provenance and preserves legacy route, publication, discovery and IAM snapshots', async () => {
  const f = await fixture();
  try {
    const snapshots = async () =>
      Promise.all(
        ['catalog_models', 'catalog_routes', 'iam_policies'].map(
          async (table) => (await f.db.query(`SELECT * FROM ${table}`)).rows,
        ),
      );
    const before = await snapshots();
    assert.equal(
      (
        await f.call('import', {
          configuration: configuration(),
          source: { routeId: 'legacy', version: 'legacy-v1' },
        })
      ).status,
      201,
    );
    const result = await f.call('read', { revision: 1 });
    assert.equal(result.body.provenance?.routeId, 'legacy');
    assert.deepEqual(result.body.provenance?.policyVersions, [
      { id: 'configuration', version: 'v1' },
    ]);
    assert.deepEqual(result.body.publication, { revision: null, generation: 0 });
    assert.deepEqual(await snapshots(), before);
    for (const source of [
      { routeId: 'legacy', version: 'stale' },
      { routeId: 'missing', version: 'legacy-v1' },
    ])
      assert.equal(
        (await f.call('import', { configuration: configuration(), source })).status,
        400,
      );
    const changed = configuration();
    const changedCandidate = changed.routes[0]?.candidates[0];
    assert.ok(changedCandidate);
    changedCandidate.id = 'unmatched';
    assert.equal(
      (
        await f.call('import', {
          configuration: changed,
          source: { routeId: 'legacy', version: 'legacy-v1' },
        })
      ).status,
      400,
    );
    await f.db.exec(
      "UPDATE catalog_routes SET jev_credential_ref='secret:legacy', jev_minimum_confidence=0.8, jev_send_prompt=true",
    );
    assert.equal(
      (
        await f.call('import', {
          configuration: configuration(),
          source: { routeId: 'legacy', version: 'legacy-v1' },
        })
      ).status,
      400,
    );
  } finally {
    await f.db.close();
  }
});

test('database/audit failures roll back writes and publication and expose fixed content-free errors', async () => {
  const f = await fixture();
  try {
    await f.call('create', { configuration: configuration() });
    await f.db.exec(
      'ALTER TABLE owned_configuration_audit ADD CONSTRAINT fail_audit CHECK (false) NOT VALID',
    );
    for (const [operation, payload] of [
      ['create', { configuration: configuration() }],
      ['publish', { revision: 1, expectedRevision: null, expectedGeneration: 0 }],
      ['read', { revision: 1 }],
    ] as const) {
      assert.deepEqual(await f.call(operation, payload), {
        status: 503,
        body: { error: 'configuration_unavailable' },
      });
    }
    assert.equal((await f.call('create', {}, 'unattached')).status, 503);
    assert.equal((await f.db.query('SELECT * FROM owned_configuration_revisions')).rows.length, 1);
    assert.deepEqual(
      (await f.db.query('SELECT revision_id, generation FROM owned_configuration_publication'))
        .rows,
      [{ revision_id: null, generation: 0 }],
    );
    await f.db.exec(
      'ALTER TABLE owned_configuration_audit DROP CONSTRAINT fail_audit; DROP TABLE owned_configuration_revisions CASCADE',
    );
    assert.deepEqual(await f.call('read', { revision: 1 }), {
      status: 503,
      body: { error: 'configuration_unavailable' },
    });
  } finally {
    await f.db.close();
  }
});

test('HTTP authentication and permission checks precede body access; all responses are private and sanitized', async () => {
  const f = await fixture();
  try {
    const handler = createOwnedConfigurationHandler({
      service: f.service,
      newRequestId: () => 'http-request',
    });
    const request = (
      operation: string,
      token = 'admin',
      body = JSON.stringify({ configuration: configuration() }),
      headers: Record<string, string> = {},
    ) =>
      new Request(`https://management.example/management/v1/routing-configurations/${operation}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...headers,
        },
        body,
      });
    for (const [token, expected] of [
      ['invalid', 401],
      ['unattached', 403],
    ] as const) {
      const input = request('create', token);
      Object.defineProperty(input, 'body', {
        get() {
          throw new Error('body must not be read before authorization');
        },
      });
      const response = await handler(input);
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (expected === 401) assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    }
    assert.equal((await handler(request('create'))).status, 201);
    assert.equal((await handler(request('read', 'admin', '{"revision":1}'))).status, 200);
    assert.equal(
      (
        await handler(
          request('create', 'admin', 'sensitive-fixture', { 'content-encoding': 'gzip' }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          request('create', 'admin', 'sensitive-fixture', { 'content-type': 'text/plain' }),
        )
      ).status,
      400,
    );
    const malformed = await handler(request('create', 'admin', 'sensitive-fixture'));
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes('sensitive-fixture'), false);
    assert.equal((await handler(request('create', 'admin', 'x'.repeat(262145)))).status, 400);
    const aborted = request('create');
    const controller = new AbortController();
    controller.abort();
    assert.equal((await handler(new Request(aborted, { signal: controller.signal }))).status, 400);
    assert.equal(
      (
        await handler(
          new Request('https://management.example/management/v1/routing-configurations/create', {
            method: 'GET',
          }),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await handler(
          new Request(
            'https://management.example/management/v1/routing-configurations/read?unsafe=1',
            { method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}' },
          ),
        )
      ).status,
      400,
    );
  } finally {
    await f.db.close();
  }
});

test('verified OpenRouter mappings and exact approved hosts persist without opening transports', async () => {
  const f = await fixture();
  try {
    const openrouter = {
      id: 'router',
      kind: 'openrouter' as const,
      origin: 'https://openrouter.ai',
      credentialRef: 'secret:router',
    };
    const destination = {
      ...mapping,
      transportProviderId: 'router',
      upstreamModelId: 'openai/gpt-fixture',
      providerSlug: 'OpenAI',
    };
    const config = configuration();
    const route = config.routes[0];
    assert.ok(route);
    const first = route.candidates[0];
    assert.ok(first);
    const candidate = {
      ...first,
      transportProviderId: 'router',
      upstreamModelId: destination.upstreamModelId,
      providerSlug: 'OpenAI',
    };
    const input = {
      ...config,
      providers: [openrouter],
      routes: [
        {
          ...route,
          candidates: [candidate],
          research: { enabled: false, environment: 'research', sharePrompt: true },
        },
      ],
    };
    f.setRegistry({ version: 'router-approval', providers: [openrouter], mappings: [destination] });
    assert.equal((await f.call('create', { configuration: input })).status, 201);
    assert.equal(
      (await f.call('read', { revision: 1 })).body.configuration?.routes[0]?.research.sharePrompt,
      true,
    );
    f.setRegistry({ version: 'revoked', providers: [openrouter], mappings: [] });
    assert.equal((await f.call('create', { configuration: input })).status, 400);
    for (const origin of [
      'https://openrouter.ai/unsafe',
      'http://openrouter.ai',
      'https://credential@openrouter.ai',
      'https://127.0.0.1',
    ]) {
      assert.equal(
        (
          await f.call('create', {
            configuration: { ...input, providers: [{ ...openrouter, origin }] },
          })
        ).status,
        400,
      );
    }
  } finally {
    await f.db.close();
  }
});

test('a retained caller cannot change the authorized operation across an await', async () => {
  const f = await fixture();
  try {
    await f.call('create', { configuration: configuration() });
    await f.db.query('UPDATE iam_policies SET statements=$1::jsonb', [
      JSON.stringify([
        { effect: 'Allow', actions: ['routing:WriteConfiguration'], resources: ['*'] },
      ]),
    ]);
    const input = {
      operation: 'create' as 'create' | 'publish',
      accessToken: 'admin',
      requestId: 'owned-input',
      readInput: async () => {
        input.operation = 'publish';
        input.requestId = 'sensitive-fixture';
        return { revision: 1, expectedRevision: null, expectedGeneration: 0 };
      },
    };
    assert.equal((await f.service.execute(input)).status, 400);
    assert.deepEqual(
      (await f.db.query('SELECT revision_id,generation FROM owned_configuration_publication')).rows,
      [{ revision_id: null, generation: 0 }],
    );
    assert.equal(JSON.stringify(await f.audit()).includes('sensitive-fixture'), false);
  } finally {
    await f.db.close();
  }
});

test('real RFC9068 tokens use current SSO bindings and IAM; revoked human access cannot publish', async () => {
  const f = await fixture();
  try {
    const jwt = await createSsoAccessTokenFixture();
    const token = await jwt.token();
    await f.db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
      jwt.issuer,
      jwt.subject,
      'admin',
    ]);
    const handler = createPostgresRfc9068OwnedConfigurationHandler({
      ...jwt.config,
      connection: f.connection,
      loadRegistry: async () => f.registry(),
      newRequestId: () => 'signed-request',
    });
    const request = (operation: string, payload: unknown, authorization = token) =>
      new Request(`https://management.example/management/v1/routing-configurations/${operation}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    assert.equal(
      (await handler(request('create', { configuration: configuration() }))).status,
      201,
    );
    assert.equal(
      (
        await handler(
          request('publish', { revision: 1, expectedRevision: null, expectedGeneration: 0 }),
        )
      ).status,
      200,
    );
    assert.equal((await handler(request('read', { revision: 1 }, `${token}changed`))).status, 401);
    await f.db.exec(
      'UPDATE iam_policies SET version=\'v2\',statements=\'[{"effect":"Deny","actions":["*"],"resources":["*"]}]\'',
    );
    assert.equal(
      (
        await handler(
          request('publish', { revision: 1, expectedRevision: 1, expectedGeneration: 1 }),
        )
      ).status,
      403,
    );
    await f.db.query('DELETE FROM iam_sso_identity_bindings WHERE issuer=$1 AND subject=$2', [
      jwt.issuer,
      jwt.subject,
    ]);
    assert.equal((await handler(request('read', { revision: 1 }))).status, 401);
    const audit = await f.audit();
    assert.deepEqual(audit.find((row) => row.outcome === 'denied')?.policy_versions, [
      { id: 'configuration', version: 'v2' },
    ]);
    assert.equal(JSON.stringify(audit).includes(token), false);
  } finally {
    await f.db.close();
  }
});

test('delegated draft import requires exact registered OpenRouter credential and verified final-provider mapping', async () => {
  const f = await fixture();
  try {
    const router = {
      id: 'router',
      kind: 'openrouter' as const,
      origin: 'https://openrouter.ai',
      credentialRef: 'secret:router',
    };
    const approved = {
      ...mapping,
      transportProviderId: 'router',
      upstreamModelId: 'openai/gpt-fixture',
      providerSlug: 'OpenAI',
    };
    f.setRegistry({ version: 'router-approval', providers: [router], mappings: [approved] });
    const config = configuration();
    const route = config.routes[0];
    assert.ok(route);
    const first = route.candidates[0];
    assert.ok(first);
    const replacement = {
      ...config,
      providers: [router],
      routes: [
        {
          ...route,
          candidates: [
            {
              ...first,
              transportProviderId: 'router',
              upstreamModelId: approved.upstreamModelId,
              providerSlug: 'OpenAI',
            },
          ],
        },
      ],
    };
    await f.db.query(
      "UPDATE catalog_routes SET kind='delegated',credential_ref='secret:router',candidates=$1::jsonb",
      [
        JSON.stringify([
          {
            id: first.id,
            kind: 'delegated',
            providerId: 'openai',
            upstreamModelId: approved.upstreamModelId,
          },
        ]),
      ],
    );
    const payload = {
      configuration: replacement,
      source: { routeId: 'legacy', version: 'legacy-v1' },
    };
    assert.equal((await f.call('import', payload)).status, 201);
    await f.db.exec("UPDATE catalog_routes SET credential_ref='secret:other'");
    assert.equal((await f.call('import', payload)).status, 400);
    assert.deepEqual((await f.call('read', { revision: null })).body.publication, {
      revision: null,
      generation: 0,
    });
  } finally {
    await f.db.close();
  }
});

test('malformed persistence and dependency failures never return configuration or expose private diagnostics', async () => {
  const f = await fixture();
  try {
    await f.call('create', { configuration: configuration() });
    await f.db.exec(
      'UPDATE owned_configuration_revisions SET configuration=\'{"sensitive-fixture":true}\'',
    );
    assert.deepEqual(await f.call('read', { revision: 1 }), {
      status: 503,
      body: { error: 'configuration_unavailable' },
    });
    for (const dependency of ['authentication', 'registry', 'database', 'audit-acknowledgement']) {
      const service = createOwnedConfigurationService({
        now: () => 1000,
        verifyAccessToken: async () => {
          if (dependency === 'authentication') throw new Error('sensitive-fixture');
          return { issuer: 'https://sso.example', subject: 'admin' };
        },
        loadRegistry: async () => {
          if (dependency === 'registry') throw new Error('sensitive-fixture');
          return f.registry();
        },
        connection: {
          transaction: (callback) => {
            if (dependency === 'database') throw new Error('sensitive-fixture');
            return f.connection.transaction((tx) =>
              callback({
                ...tx,
                query: async (sql, params) => {
                  const result = await tx.query(sql, params);
                  return dependency === 'audit-acknowledgement' &&
                    sql.includes('INSERT INTO owned_configuration_audit')
                    ? { rows: [] }
                    : result;
                },
              }),
            );
          },
        },
      });
      const result = await service.execute({
        operation: 'create',
        accessToken: 'admin',
        requestId: `failure-${dependency}`,
        readInput: async () => ({ configuration: configuration() }),
      });
      assert.deepEqual(result, { status: 503, body: { error: 'configuration_unavailable' } });
    }
    assert.equal((await f.db.query('SELECT * FROM owned_configuration_revisions')).rows.length, 1);
    assert.equal(JSON.stringify(await f.audit()).includes('sensitive-fixture'), false);
  } finally {
    await f.db.close();
  }
});

test('approved OpenRouter attestations still require adapter-valid slugs and missing legacy registrations reject import', async () => {
  const f = await fixture();
  try {
    const config = configuration();
    const route = config.routes[0];
    assert.ok(route);
    const candidate = route.candidates[0];
    assert.ok(candidate);
    const router = {
      ...provider,
      id: 'router',
      kind: 'openrouter' as const,
      origin: 'https://openrouter.ai',
      credentialRef: 'secret:router',
    };
    f.setRegistry({
      version: 'malformed-slug-approval',
      providers: [router],
      mappings: [{ ...mapping, transportProviderId: 'router', providerSlug: 'bad@provider' }],
    });
    assert.equal(
      (
        await f.call('create', {
          configuration: {
            ...config,
            providers: [router],
            routes: [
              {
                ...route,
                candidates: [
                  { ...candidate, transportProviderId: 'router', providerSlug: 'bad@provider' },
                ],
              },
            ],
          },
        })
      ).status,
      400,
    );
    f.setRegistry({ version: 'direct-approval', providers: [provider], mappings: [mapping] });
    await f.db.exec('DELETE FROM direct_provider_registrations');
    assert.equal(
      (
        await f.call('import', {
          configuration: configuration(),
          source: { routeId: 'legacy', version: 'legacy-v1' },
        })
      ).status,
      400,
    );
  } finally {
    await f.db.close();
  }
});

test('publication acknowledgement must match the committed generation or the mutation rolls back', async () => {
  const f = await fixture();
  try {
    await f.call('create', { configuration: configuration() });
    const service = createOwnedConfigurationService({
      now: () => 1000,
      loadRegistry: async () => f.registry(),
      verifyAccessToken: async () => ({ issuer: 'https://sso.example', subject: 'admin' }),
      connection: {
        transaction: (callback) =>
          f.connection.transaction((tx) =>
            callback({
              ...tx,
              query: async (sql, params) => {
                const result = await tx.query(sql, params);
                return sql.startsWith('UPDATE owned_configuration_publication')
                  ? { rows: [{ generation: 99 }] }
                  : result;
              },
            }),
          ),
      },
    });
    assert.deepEqual(
      await service.execute({
        operation: 'publish',
        accessToken: 'admin',
        requestId: 'bad-ack',
        readInput: async () => ({ revision: 1, expectedRevision: null, expectedGeneration: 0 }),
      }),
      { status: 503, body: { error: 'configuration_unavailable' } },
    );
    assert.deepEqual((await f.call('read', { revision: null })).body.publication, {
      revision: null,
      generation: 0,
    });
  } finally {
    await f.db.close();
  }
});
