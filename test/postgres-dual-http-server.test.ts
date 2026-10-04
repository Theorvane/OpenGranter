import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createNodePostgresDualRouteChatServer } from '../src/gateway/node-postgres-dual-chat-server.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { applyPostgresMigrations } from '../src/storage/postgres-migrations.ts';

async function fixture(direct = true) {
  const db = new PGlite();
  const client = { query: (sql: string, params: readonly unknown[]) => db.query(sql, [...params]) };
  await applyPostgresMigrations(
    {
      transaction: (callback) =>
        db.transaction((tx) =>
          callback({
            exec: (sql) => tx.exec(sql),
            query: (sql, params) => tx.query(sql, [...params]),
          }),
        ),
    },
    await loadPostgresMigrationSources(),
    () => 1000,
  );
  await db.exec(`
    INSERT INTO iam_principals VALUES ('service-1', 'service', true);
    INSERT INTO iam_policies VALUES ('allow', 'v1', '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider","usage:ReadSelf","audit:Read"],"resources":["*"]},{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:denied-provider"]}]');
    INSERT INTO iam_principal_policies VALUES ('service-1', 'allow');
    INSERT INTO catalog_models VALUES ('direct-chat', 1000, true, NULL), ('or-chat', 1000, true, NULL);
    INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
      ('direct-v1', 'direct-chat', 'managed', 'v1', NULL, '[{"id":"direct","kind":"managed","providerId":"openai","upstreamModelId":"gpt-fixture"}]'),
      ('or-v1', 'or-chat', 'delegated', 'v1', 'secret/openrouter', '[{"id":"allowed","kind":"delegated","providerId":"openai","upstreamModelId":"openai/gpt-fixture"},{"id":"denied","kind":"delegated","providerId":"denied-provider","upstreamModelId":"openai/gpt-fixture"}]');
    UPDATE catalog_models SET active_route_id = 'direct-v1' WHERE alias = 'direct-chat';
    UPDATE catalog_models SET active_route_id = 'or-v1' WHERE alias = 'or-chat';
    INSERT INTO openrouter_provider_mappings VALUES ('openai', 'openai/gpt-fixture', 'openai', true, true), ('denied-provider', 'openai/gpt-fixture', 'azure', true, true);
  `);
  if (direct)
    await db.exec(
      "INSERT INTO direct_provider_registrations VALUES ('openai', 'openai', 'secret/openai', true, NULL)",
    );
  const tokens = createProxyTokenService({
    store: createPostgresProxyCredentialStore(client),
    now: () => 1000,
  });
  const issued = await tokens.issue({
    principalId: 'service-1',
    actorId: 'bootstrap',
    requestId: 'issued',
    expiresAt: 10000,
  });
  const secrets: string[] = [];
  const hosts: string[] = [];
  const state = { limit: true, secret: true, upstreamStatus: 200, streamFailure: false };
  let sequence = 0;
  const server = await createNodePostgresDualRouteChatServer({
    client,
    now: () => 1000,
    newRequestId: () => `dual-${++sequence}`,
    checkLimit: async () => state.limit,
    resolveSecret: async (ref) => {
      secrets.push(ref);
      return state.secret ? 'fixture-upstream-key' : undefined;
    },
    timeoutMs: 1000,
    ...{
      invokeDirectFunctionStream: async () => {
        throw new Error('unexpected native function override');
      },
      invokeDirectTextStream: async () => {
        throw new Error('unexpected direct stream override');
      },
      invokeOpenRouter: async () => {
        throw new Error('unexpected runtime override');
      },
      invokeOpenRouterFunctionStream: async () => {
        throw new Error('unexpected function override');
      },
      resolveVerifiedProviderSlug: async () => {
        throw new Error('unexpected mapping override');
      },
    },
    fetcher: async (url, init) => {
      hosts.push(String(url));
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      const body = JSON.parse(String(init?.body));
      if (String(url).includes('openrouter.ai')) {
        assert.equal(body.model, 'openai/gpt-fixture');
        assert.deepEqual(body.provider, { only: ['openai'] });
        assert.equal(typeof body.stream, 'boolean');
      } else {
        assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
        assert.equal(body.model, 'gpt-fixture');
      }
      if (state.upstreamStatus !== 200)
        return new Response('private-upstream-failure', { status: state.upstreamStatus });
      if (body.stream === true && !String(url).includes('openrouter.ai')) {
        assert.deepEqual(body.stream_options, { include_usage: true });
        const identity = {
          id: 'native-stream',
          created: 1000,
          model: body.model,
          object: 'chat.completion.chunk',
        };
        const answered = body.messages.some((message: { role: string }) => message.role === 'tool');
        const functionCall = body.tools?.length > 0 && !answered;
        const frames = [
          {
            ...identity,
            choices: [
              {
                index: 0,
                delta: functionCall
                  ? {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call',
                          type: 'function',
                          function: { name: 'lookup', arguments: '{}' },
                        },
                      ],
                    }
                  : { content: 'private-response' },
                finish_reason: null,
              },
            ],
            usage: null,
          },
          {
            ...identity,
            choices: [{ index: 0, delta: {}, finish_reason: functionCall ? 'tool_calls' : 'stop' }],
            usage: null,
          },
          {
            ...identity,
            choices: [],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
          },
        ];
        return new Response(
          frames.map((chunk) => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      if (body.stream === true) {
        const frame = (delta: object, finish: string | null, usage?: object) =>
          `data: ${JSON.stringify({
            id: 'stream-fixture',
            object: 'chat.completion.chunk',
            created: 1000,
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...(usage ? { usage } : {}),
          })}\n\n`;
        if (
          body.tools !== undefined ||
          body.messages.some((message: { role: string }) => message.role === 'tool')
        ) {
          const answered = body.messages.some(
            (message: { role: string }) => message.role === 'tool',
          );
          const finish = answered ? 'stop' : 'tool_calls';
          const delta = answered
            ? { content: 'private final answer' }
            : {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call',
                    type: 'function',
                    function: { name: 'lookup', arguments: '{"q":' },
                  },
                ],
              };
          const source =
            frame(delta, null) +
            (answered
              ? ''
              : frame(
                  { tool_calls: [{ index: 0, function: { arguments: '"private 終"}' } }] },
                  null,
                )) +
            (state.streamFailure
              ? 'data: ' +
                JSON.stringify({ error: { code: 502, message: 'private-stream-failure' } }) +
                '\n\n'
              : frame({}, finish) +
                frame({}, finish, { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) +
                'data: [DONE]\n\n');
          return new Response(source, { headers: { 'content-type': 'text/event-stream' } });
        }
        const source =
          frame({ content: 'private-response' }, null) +
          (state.streamFailure
            ? `data: ${JSON.stringify({ error: { code: 502, message: 'private-stream-failure' } })}\n\n`
            : frame({}, 'stop') +
              frame({}, 'stop', { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) +
              'data: [DONE]\n\n');
        return new Response(source, { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json({
        id: 'completion-fixture',
        created: 1000,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'private-response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    },
  });
  assert.equal(server.listening, false);
  assert.deepEqual(secrets, []);
  assert.deepEqual(hosts, []);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' };
  const call = (model = 'or-chat') =>
    fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'private-prompt' }] }),
    });
  const close = async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  };
  return { db, client, server, base, headers, call, close, tokens, issued, secrets, hosts, state };
}

test('one persisted socket and token invoke both route kinds and retain content-free history', async () => {
  const { db, base, headers, call, close, secrets, hosts, issued } = await fixture();
  try {
    for (const model of ['direct-chat', 'or-chat']) {
      const response = await call(model);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { model: string };
      assert.equal(body.model, model);
    }
    assert.deepEqual(secrets, ['secret/openai', 'secret/openrouter']);
    assert.deepEqual(hosts, [
      'https://api.openai.com/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
    ]);
    const models = await fetch(`${base}/v1/models`, { headers });
    assert.equal(models.status, 200);
    assert.deepEqual(
      ((await models.json()) as { data: { id: string }[] }).data.map((item) => item.id).sort(),
      ['direct-chat', 'or-chat'],
    );
    for (const path of ['usage', 'audit']) {
      const response = await fetch(`${base}/v1/${path}`, { headers });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok((JSON.parse(text) as { data: unknown[] }).data.length > 0);
      for (const secret of [
        'private-prompt',
        'private-response',
        'fixture-upstream-key',
        issued.token,
      ])
        assert.equal(text.includes(secret), false);
    }
    const usage = await db.query<{ record: { routeKind: string } }>(
      'SELECT record FROM usage_records',
    );
    assert.deepEqual(usage.rows.map((item) => item.record.routeKind).sort(), [
      'delegated',
      'managed',
    ]);
  } finally {
    await close();
  }
});

test('persisted dual composition streams both bases and stores sanitized interruption metadata', async () => {
  const { db, base, headers, close, state } = await fixture(false);
  try {
    for (const prefix of ['/v1', '/api/v1']) {
      const response = await fetch(`${base}${prefix}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'or-chat',
          messages: [{ role: 'user', content: 'private-prompt' }],
          stream: true,
        }),
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(text.includes('"model":"or-chat"'));
      assert.ok(text.endsWith('data: [DONE]\n\n'));
    }
    state.streamFailure = true;
    const failed = await fetch(`${base}/api/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'or-chat',
        messages: [{ role: 'user', content: 'private-prompt' }],
        stream: true,
      }),
    });
    const text = await failed.text();
    assert.ok(text.includes('upstream_failed'));
    assert.equal(text.includes('[DONE]'), false);
    assert.equal(text.includes('private-stream-failure'), false);
    const audit = await db.query<{ details: unknown }>(
      "SELECT details FROM gateway_audit_events WHERE kind = 'stream-interrupted'",
    );
    assert.deepEqual(
      audit.rows.map((row) => row.details),
      [{ routeVersion: 'v1', modelAlias: 'or-chat', outcome: 'failed', upstreamCompleted: false }],
    );
    const usage = await db.query<{ record: { outcome: string } }>(
      'SELECT record FROM usage_records ORDER BY attempt_id',
    );
    assert.deepEqual(
      usage.rows.map((row) => row.record.outcome),
      ['succeeded', 'succeeded', 'failed'],
    );
    assert.equal(
      JSON.stringify({ audit: audit.rows, usage: usage.rows }).includes('private'),
      false,
    );
  } finally {
    await close();
  }
});

test('mapping, IAM and limit denials block contact; secret/upstream/audit failures remain safe without route switching', async () => {
  const { db, call, close, secrets, hosts, state } = await fixture();
  try {
    for (const update of [
      "UPDATE openrouter_provider_mappings SET enabled = false WHERE provider_id = 'openai'",
      "UPDATE openrouter_provider_mappings SET enabled = true, verified = false WHERE provider_id = 'openai'",
    ]) {
      await db.exec(update);
      const response = await call();
      assert.equal(response.status, 503);
      await response.text();
    }
    await db.exec(
      "UPDATE openrouter_provider_mappings SET enabled = true, verified = true WHERE provider_id = 'openai'",
    );
    state.limit = false;
    assert.equal((await call()).status, 429);
    state.limit = true;
    await db.exec(
      `INSERT INTO iam_policies VALUES ('deny', 'v1', '[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:openai"]}]'); INSERT INTO iam_principal_policies VALUES ('service-1', 'deny')`,
    );
    for (const model of ['direct-chat', 'or-chat']) assert.equal((await call(model)).status, 403);
    assert.deepEqual(secrets, []);
    assert.deepEqual(hosts, []);
    await db.exec("DELETE FROM iam_principal_policies WHERE policy_id = 'deny'");
    state.secret = false;
    assert.equal((await call()).status, 503);
    assert.deepEqual(secrets, ['secret/openrouter']);
    assert.deepEqual(hosts, []);
    state.secret = true;
    state.upstreamStatus = 503;
    const failed = await call();
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes('private-upstream-failure'), false);
    assert.deepEqual(hosts, ['https://openrouter.ai/api/v1/chat/completions']);
    await db.exec('DROP TABLE gateway_audit_events');
    assert.equal((await call()).status, 503);
    assert.equal(secrets.length, 2);
    assert.equal(hosts.length, 1);
  } finally {
    await close();
  }
});

test('delegated-only construction works and revoked tokens stop both paths before secrets', async () => {
  const { call, close, tokens, issued, secrets, hosts } = await fixture(false);
  try {
    const response = await call();
    assert.equal(response.status, 200);
    await response.text();
    await tokens.revoke({
      credentialId: issued.credentialId,
      actorId: 'admin',
      requestId: 'revoked',
    });
    for (const model of ['direct-chat', 'or-chat']) assert.equal((await call(model)).status, 401);
    assert.deepEqual(secrets, ['secret/openrouter']);
    assert.deepEqual(hosts, ['https://openrouter.ai/api/v1/chat/completions']);
  } finally {
    await close();
  }
});

test('registration bootstrap failure rejects safely before transport or secret lookup', async () => {
  let external = 0;
  await assert.rejects(
    createNodePostgresDualRouteChatServer({
      client: {
        query: async () => {
          throw new Error('private-driver-secret');
        },
      },
      now: () => 1000,
      newRequestId: () => 'id',
      checkLimit: async () => true,
      resolveSecret: async () => {
        external++;
        return 'fixture';
      },
      fetcher: async () => {
        external++;
        return Response.json({});
      },
    }),
    {
      name: 'DirectProviderStoreUnavailable',
      message: 'Direct provider registration store unavailable',
    },
  );
  assert.equal(external, 0);
});

test('persisted dual composition activates scoped function streams and complete tool results on both bases', async () => {
  const f = await fixture(false);
  try {
    for (const prefix of ['/v1', '/api/v1']) {
      const messages: object[] = [{ role: 'user', content: 'private prompt' }];
      const body = {
        model: 'or-chat',
        messages,
        stream: true,
        tools: [{ type: 'function', function: { name: 'lookup' } }],
        tool_choice: 'auto',
        parallel_tool_calls: false,
      };
      const call = () =>
        fetch(f.base + prefix + '/chat/completions', {
          method: 'POST',
          headers: f.headers,
          body: JSON.stringify(body),
        });
      const first = await call();
      assert.equal(first.status, 200);
      const text = await first.text();
      assert.ok(text.includes('"finish_reason":"tool_calls"'));
      assert.ok(text.endsWith('data: [DONE]\n\n'));
      messages.push(
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"private 終"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call', content: 'private result' },
      );
      const second = await call();
      assert.equal(second.status, 200);
      const final = await second.text();
      assert.ok(final.includes('private final answer'));
      assert.ok(final.endsWith('data: [DONE]\n\n'));
    }
    const records = await f.db.query<{ record: unknown }>('SELECT record FROM usage_records');
    assert.equal(records.rows.length, 4);
    const audit = await f.db.query<{ details: unknown }>(
      'SELECT details FROM gateway_audit_events',
    );
    assert.equal(JSON.stringify([records.rows, audit.rows]).includes('private'), false);
    assert.ok(f.hosts.every((host) => host === 'https://openrouter.ai/api/v1/chat/completions'));
  } finally {
    await f.close();
  }
});

test('persisted function streams deny before secrets and sanitize partial failures', async () => {
  const f = await fixture(false);
  try {
    const body = {
      model: 'or-chat',
      messages: [{ role: 'user', content: 'private prompt' }],
      stream: true,
      tools: [{ type: 'function', function: { name: 'lookup' } }],
    };
    const call = () =>
      fetch(f.base + '/api/v1/chat/completions', {
        method: 'POST',
        headers: f.headers,
        body: JSON.stringify(body),
      });
    f.state.limit = false;
    assert.equal((await call()).status, 429);
    f.state.limit = true;
    await f.db.exec(
      `INSERT INTO iam_policies VALUES ('deny-stream', 'v1', '[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:openai"]}]'); INSERT INTO iam_principal_policies VALUES ('service-1', 'deny-stream')`,
    );
    assert.equal((await call()).status, 403);
    assert.equal(f.secrets.length, 0);
    assert.equal(f.hosts.length, 0);
    await f.db.exec("DELETE FROM iam_principal_policies WHERE policy_id='deny-stream'");
    f.state.streamFailure = true;
    const response = await call(),
      text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes('[DONE]'), false);
    assert.equal(text.includes('private-stream-failure'), false);
    const usage = await f.db.query<{ record: { outcome: string } }>(
      'SELECT record FROM usage_records',
    );
    assert.equal(usage.rows[0]?.record.outcome, 'failed');
    const audit = await f.db.query('SELECT details FROM gateway_audit_events');
    assert.equal(JSON.stringify([usage.rows, audit.rows]).includes('private'), false);
  } finally {
    await f.close();
  }
});

test('persisted dual composition generates controlled native stream port and ignores runtime overrides', async () => {
  const { db, base, headers, close, secrets, hosts } = await fixture();
  try {
    for (const prefix of ['/v1', '/api/v1']) {
      const response = await fetch(base + prefix + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'direct-chat',
          messages: [{ role: 'user', content: 'private-prompt' }],
          stream: true,
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(body.includes('"model":"direct-chat"'));
      assert.ok(body.endsWith('data: [DONE]\n\n'));
    }
    assert.deepEqual(secrets, ['secret/openai', 'secret/openai']);
    assert.ok(hosts.every((host) => host === 'https://api.openai.com/v1/chat/completions'));
    const records = await db.query<{ record: { outcome: string; routeKind: string } }>(
      'SELECT record FROM usage_records',
    );
    assert.equal(records.rows.length, 2);
    assert.ok(
      records.rows.every(
        (row) => row.record.outcome === 'succeeded' && row.record.routeKind === 'managed',
      ),
    );
    const history = await fetch(base + '/v1/audit', { headers });
    assert.equal(history.status, 200);
    assert.ok(!(await history.text()).includes('private-response'));
  } finally {
    await close();
  }
});

test('persisted dual generated native function streams complete correlated results and re-evaluate Deny', async () => {
  const { db, base, headers, close, secrets } = await fixture();
  try {
    for (const prefix of ['/v1', '/api/v1']) {
      const body = {
        model: 'direct-chat',
        messages: [{ role: 'user', content: 'private-prompt' }],
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
        stream: true,
      };
      const send = (value: unknown) =>
        fetch(base + prefix + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(value),
        });
      const first = await send(body);
      assert.equal(first.status, 200);
      assert.ok((await first.text()).includes('tool_calls'));
      const follow = await send({
        ...body,
        messages: [
          ...body.messages,
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call', content: 'private-result' },
        ],
      });
      assert.equal(follow.status, 200);
      assert.ok((await follow.text()).includes('private-response'));
    }
    const usage = await db.query<{ record: { routeKind: string; outcome: string } }>(
      'SELECT record FROM usage_records',
    );
    assert.equal(usage.rows.length, 4);
    assert.ok(
      usage.rows.every(
        (row) => row.record.routeKind === 'managed' && row.record.outcome === 'succeeded',
      ),
    );
    await db.exec(
      'INSERT INTO iam_policies VALUES (\'native-deny\', \'v1\', \'[{"effect":"Deny","actions":["llm:UseProvider"],"resources":["provider:openai"]}]\'); INSERT INTO iam_principal_policies VALUES (\'service-1\', \'native-deny\');',
    );
    const denied = await fetch(base + '/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'direct-chat',
        messages: [{ role: 'user', content: 'private-prompt' }],
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
        stream: true,
      }),
    });
    assert.equal(denied.status, 403);
    await denied.text();
    assert.equal(secrets.length, 4);
  } finally {
    await close();
  }
});
