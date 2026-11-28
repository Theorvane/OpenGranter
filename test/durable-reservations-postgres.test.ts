import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createPostgresConnection } from '../src/storage/postgres-connection.ts';
import {
  createDurableReservations,
  type ReservationInput,
} from '../src/usage/durable-reservations.ts';

const socket = process.env.OPENGRANTER_RESERVATION_TEST_SOCKET;
test('installed PostgreSQL independent pools serialize monetary admission and crash recovery', {
  skip: !socket,
}, async () => {
  assert.ok(socket?.startsWith('/tmp/'));
  const schema = `reservations_${randomUUID().replaceAll('-', '')}`;
  const config = {
    host: socket,
    port: 55438,
    database: 'postgres',
    user: process.env.USER,
    max: 4,
  };
  const admin = createPostgresConnection(config);
  await admin.query(`CREATE SCHEMA ${schema}`, []);
  const first = createPostgresConnection({ ...config, options: `-c search_path=${schema}` });
  const second = createPostgresConnection({ ...config, options: `-c search_path=${schema}` });
  try {
    for (const name of [
      '001_usage_records.sql',
      '003_gateway_audit.sql',
      '015_durable_reservations.sql',
    ])
      await first.query(
        await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
        [],
      );
    await first.query(
      `INSERT INTO reservation_principals(principal_id,version,currency,window_ms,request_limit,budget,valid_until_ms)
      VALUES('person','v1','USD',1000,100,10,10000)`,
      [],
    );
    const ports = { now: () => 100, resolveEvidence: async () => undefined };
    const services = [
      createDurableReservations({ ...ports, connection: first }),
      createDurableReservations({ ...ports, connection: second }),
    ];
    const input = (requestId: string): ReservationInput => ({
      requestId,
      principalId: 'person',
      credentialId: 'token',
      policyVersions: [{ id: 'iam', version: '1' }],
      principalActive: true,
      statements: [{ effect: 'Allow', actions: ['*'], resources: ['*'] }],
      modelAlias: 'chat',
      routeVersion: 'route1',
      requestBinding: 'bound1',
      expiresAt: 500,
      candidates: [
        {
          id: 'a',
          providerId: 'openai',
          transportProviderId: 'router',
          upstreamModelId: 'model',
          liability: '6',
          currency: 'USD',
          attestationId: 'ceiling1',
          validUntil: 10000,
        },
      ],
    });
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => {
        const service = services[i % 2];
        assert.ok(service);
        return service.reserve(input(`r${i}`));
      }),
    );
    assert.equal(results.filter((r) => r.status === 'admitted').length, 1);
    assert.equal(results.filter((r) => r.status === 'denied').length, 15);
    const result = results.find((r) => r.status === 'admitted');
    assert.ok(result?.status === 'admitted');
    const service = services[0];
    assert.ok(service);
    const attempt = await service.start(result.handle, 'a');
    await first.close();
    const recovered = createDurableReservations({ ...ports, connection: second, now: () => 600 });
    assert.deepEqual(await recovered.recover('person'), [attempt]);
    await assert.rejects(recovered.start(result.handle, 'a'));
    assert.equal((await recovered.reserve({ ...input('later'), expiresAt: 900 })).status, 'denied');
  } finally {
    await first.close();
    await second.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`, []);
    await admin.close();
  }
});
