import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  startPostgresGateway as startDirectGateway,
  startPostgresDualRouteGateway,
} from '../src/gateway/postgres-gateway-runtime.ts';
import { createPostgresProxyCredentialStore } from '../src/gateway/postgres-proxy-credentials.ts';
import { createProxyTokenService } from '../src/gateway/proxy-tokens.ts';
import type { PostgresConnection } from '../src/storage/postgres-connection.ts';

const startupError = { name: 'GatewayStartupUnavailable', message: 'Gateway startup unavailable' };
const shutdownError = {
  name: 'GatewayShutdownUnavailable',
  message: 'Gateway shutdown unavailable',
};

function fixture() {
  const db = new PGlite();
  let opens = 0;
  let closes = 0;
  let externalCalls = 0;
  let auditGate: (() => Promise<void>) | undefined;
  const connection: PostgresConnection = {
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO gateway_audit_events')) await auditGate?.();
      return db.query(sql, [...params]);
    },
    transaction: (callback) =>
      db.transaction((tx) =>
        callback({
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, [...params]),
        }),
      ),
    close: async () => {
      closes++;
      await db.close();
    },
  };
  const ports = {
    host: '127.0.0.1',
    port: 0,
    openConnection: () => {
      opens++;
      return connection;
    },
    now: () => 1000,
    newRequestId: () => 'runtime-request',
    checkLimit: async () => true,
    resolveSecret: async () => {
      externalCalls++;
      return undefined;
    },
    fetcher: async () => {
      externalCalls++;
      throw new Error('unexpected provider');
    },
  };
  return {
    db,
    ports,
    connection,
    counts: () => ({ opens, closes, externalCalls }),
    gateAudit: (gate: () => Promise<void>) => {
      auditGate = gate;
    },
  };
}

for (const [kind, startPostgresGateway] of [
  ['direct', startDirectGateway],
  ['dual', startPostgresDualRouteGateway],
] as const) {
  test(`${kind}: runtime starts a migrated socket and shares one shutdown promise`, async () => {
    const { db, ports, counts } = fixture();
    const runtime = await startPostgresGateway(ports);
    const url = `http://127.0.0.1:${runtime.address.port}/v1/models`;
    try {
      assert.equal(runtime.address.address, '127.0.0.1');
      assert.ok(runtime.address.port > 0);
      const response = await fetch(url);
      assert.equal(response.status, 401);
      await response.text();
      assert.deepEqual((await db.query('SELECT kind FROM gateway_audit_events')).rows, [
        { kind: 'auth-denied' },
      ]);
      assert.deepEqual(counts(), { opens: 1, closes: 0, externalCalls: 0 });
    } finally {
      const close = runtime.close();
      assert.equal(runtime.close(), close);
      await close;
      assert.equal(runtime.close(), close);
    }
    assert.equal(counts().closes, 1);
    await assert.rejects(fetch(url));
  });

  test(`${kind}: shutdown waits for an active audit write before closing the database`, {
    timeout: 15_000,
  }, async () => {
    const { ports, counts, gateAudit } = fixture();
    const runtime = await startPostgresGateway(ports);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    gateAudit(async () => {
      entered();
      await gate;
    });
    const response = fetch(`http://127.0.0.1:${runtime.address.port}/v1/models`);
    try {
      await started;
      const closing = runtime.close();
      await nextTurn();
      assert.equal(counts().closes, 0);
      release();
      const result = await response;
      assert.equal(result.status, 401);
      await result.text();
      await closing;
      assert.equal(counts().closes, 1);
    } finally {
      release();
      await runtime.close();
    }
  });

  test(`${kind}: invalid bind input and source loading failure occur before connection opening`, async () => {
    const { db, ports, counts } = fixture();
    try {
      for (const input of [
        { host: '' },
        { host: 'bad host' },
        { port: -1 },
        { port: 65536 },
        { port: 0.5 },
      ]) {
        await assert.rejects(startPostgresGateway({ ...ports, ...input }), {
          name: 'InvalidGatewayRuntimeInput',
          message: 'Invalid gateway runtime input',
        });
      }
      await assert.rejects(
        startPostgresGateway({
          ...ports,
          migrationDirectory: new URL('https://invalid.example/private-bundle'),
        }),
        startupError,
      );
      assert.deepEqual(counts(), { opens: 0, closes: 0, externalCalls: 0 });
    } finally {
      await db.close();
    }
  });

  test(`${kind}: connection opening failures expose no driver details or causes`, async () => {
    const { db, ports } = fixture();
    try {
      await assert.rejects(
        startPostgresGateway({
          ...ports,
          openConnection: () => {
            throw new Error('private-connection-detail');
          },
        }),
        (error: unknown) => {
          assert.equal((error as Error).name, startupError.name);
          assert.equal((error as Error).message, startupError.message);
          assert.equal((error as Error).cause, undefined);
          return true;
        },
      );
    } finally {
      await db.close();
    }
  });

  test(`${kind}: migration failure closes the opened connection without external calls`, async () => {
    const { ports, connection, counts } = fixture();
    await assert.rejects(
      startPostgresGateway({
        ...ports,
        openConnection: () => ({
          ...connection,
          transaction: async () => {
            throw new Error('private-sql-detail');
          },
        }),
      }),
      startupError,
    );
    assert.equal(counts().closes, 1);
    assert.equal(counts().externalCalls, 0);
  });

  test(`${kind}: an occupied bind port closes the opened database on startup failure`, async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const { ports, counts } = fixture();
    try {
      await assert.rejects(
        startPostgresGateway({ ...ports, port: (blocker.address() as AddressInfo).port }),
        startupError,
      );
      assert.deepEqual(counts(), { opens: 1, closes: 1, externalCalls: 0 });
    } finally {
      await new Promise<void>((resolve, reject) =>
        blocker.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test(`${kind}: database shutdown failure is safe, shared, and not automatically retried`, async () => {
    const { ports, connection } = fixture();
    let attempts = 0;
    const runtime = await startPostgresGateway({
      ...ports,
      openConnection: () => ({
        ...connection,
        close: async () => {
          attempts++;
          await connection.close();
          throw new Error('private-close-detail');
        },
      }),
    });
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await assert.rejects(closing, (error: unknown) => {
      assert.equal((error as Error).name, shutdownError.name);
      assert.equal((error as Error).message, shutdownError.message);
      assert.equal((error as Error).cause, undefined);
      return true;
    });
    assert.equal(runtime.close(), closing);
    assert.equal(attempts, 1);
  });

  test(`${kind}: failed startup cleanup does not replace the safe startup error with a driver error`, async () => {
    const { ports, connection } = fixture();
    let attempts = 0;
    await assert.rejects(
      startPostgresGateway({
        ...ports,
        openConnection: () => ({
          ...connection,
          transaction: async () => {
            throw new Error('private-startup-detail');
          },
          close: async () => {
            attempts++;
            await connection.close();
            throw new Error('private-cleanup-detail');
          },
        }),
      }),
      startupError,
    );
    assert.equal(attempts, 1);
  });

  test(`${kind}: configuration loading failure closes DB before external calls`, async () => {
    const { ports, connection, counts } = fixture();
    await assert.rejects(
      startPostgresGateway({
        ...ports,
        openConnection: () => ({
          ...connection,
          query: async (sql, params) => {
            if (sql.includes('FROM direct_provider_registrations'))
              throw new Error('private-config-detail');
            return connection.query(sql, params);
          },
        }),
      }),
      startupError,
    );
    assert.equal(counts().closes, 1);
    assert.equal(counts().externalCalls, 0);
  });
}

test('dual runtime migrates before configuration and invokes both persisted route kinds', async () => {
  const { db, ports, connection, counts } = fixture();
  let configured = false;
  const hosts: string[] = [];
  const secrets: string[] = [];
  let sequence = 0;
  const runtime = await startPostgresDualRouteGateway({
    ...ports,
    newRequestId: () => `dual-runtime-${++sequence}`,
    openConnection: () => ({
      ...connection,
      query: async (sql, params) => {
        if (sql.includes('FROM direct_provider_registrations') && !configured) {
          const history = await db.query<{ version: string }>(
            'SELECT version FROM schema_migrations ORDER BY version',
          );
          assert.deepEqual(
            history.rows.map((row) => row.version),
            ['001', '002', '003', '004', '005', '006', '007', '008', '009'],
          );
          await db.exec(`
            INSERT INTO iam_principals VALUES ('service-1', 'service', true);
            INSERT INTO iam_policies VALUES ('allow', 'v1', '[{"effect":"Allow","actions":["llm:InvokeModel","llm:UseProvider"],"resources":["*"]}]');
            INSERT INTO iam_principal_policies VALUES ('service-1', 'allow');
            INSERT INTO catalog_models VALUES ('direct-chat', 1000, true, NULL), ('or-chat', 1000, true, NULL);
            INSERT INTO catalog_routes (route_id, alias, kind, version, credential_ref, candidates) VALUES
              ('direct-v1', 'direct-chat', 'managed', 'v1', NULL, '[{"id":"direct","kind":"managed","providerId":"openai","upstreamModelId":"gpt-fixture"}]'),
              ('or-v1', 'or-chat', 'delegated', 'v1', 'secret/openrouter', '[{"id":"delegated","kind":"delegated","providerId":"openai","upstreamModelId":"openai/gpt-fixture"}]');
            UPDATE catalog_models SET active_route_id = 'direct-v1' WHERE alias = 'direct-chat';
            UPDATE catalog_models SET active_route_id = 'or-v1' WHERE alias = 'or-chat';
            INSERT INTO direct_provider_registrations VALUES ('openai', 'openai', 'secret/openai', true, NULL);
            INSERT INTO openrouter_provider_mappings VALUES ('openai', 'openai/gpt-fixture', 'openai', true, true);
          `);
          configured = true;
        }
        return connection.query(sql, params);
      },
    }),
    resolveSecret: async (ref) => {
      secrets.push(ref);
      return 'fixture-provider-key';
    },
    fetcher: async (url, init) => {
      hosts.push(String(url));
      const body = JSON.parse(String(init?.body));
      if (String(url).includes('openrouter.ai'))
        assert.deepEqual(body.provider, { only: ['openai'] });
      return Response.json({
        id: 'completion',
        created: 1000,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'fixture response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    },
  });
  try {
    assert.equal(configured, true);
    assert.deepEqual(hosts, []);
    assert.deepEqual(secrets, []);
    const tokens = createProxyTokenService({
      store: createPostgresProxyCredentialStore(connection),
      now: ports.now,
    });
    const issued = await tokens.issue({
      principalId: 'service-1',
      actorId: 'bootstrap',
      requestId: 'issued',
      expiresAt: 10000,
    });
    for (const model of ['direct-chat', 'or-chat']) {
      const response = await fetch(`http://127.0.0.1:${runtime.address.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'fixture request' }] }),
      });
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { model: string }).model, model);
    }
    assert.deepEqual(secrets, ['secret/openai', 'secret/openrouter']);
    assert.deepEqual(hosts, [
      'https://api.openai.com/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
    ]);
    const usage = await db.query<{ record: { routeKind: string } }>(
      'SELECT record FROM usage_records',
    );
    assert.deepEqual(usage.rows.map((row) => row.record.routeKind).sort(), [
      'delegated',
      'managed',
    ]);
    const audit = await db.query<{ kind: string }>('SELECT kind FROM gateway_audit_events');
    assert.ok(audit.rows.some((row) => row.kind === 'delegated-selection'));
    assert.ok(audit.rows.some((row) => row.kind === 'decision'));
  } finally {
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await closing;
  }
  assert.equal(counts().closes, 1);
});
