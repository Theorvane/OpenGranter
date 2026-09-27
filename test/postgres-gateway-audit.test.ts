import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresGatewayAuditStore,
  type GatewayAuditInput,
  projectGatewayAuditEvent,
} from '../src/audit/postgres-gateway-audit.ts';

const migration = await readFile(
  new URL('../migrations/003_gateway_audit.sql', import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  await db.exec(migration);
  const store = createPostgresGatewayAuditStore(
    {
      query: (sql, params) => db.query(sql, [...params]),
    },
    () => 1_000,
  );
  return { db, store };
}

const attribution = {
  principalId: 'service-1',
  credentialId: 'credential-1',
  policyVersions: [{ id: 'allow', version: 'v1' }],
};

test('append persists only known attributed and anonymous gateway metadata', async () => {
  const { db, store } = await fixture();
  try {
    await store.append({
      ...attribution,
      kind: 'models-listed',
      requestId: 'request-1',
      count: 2,
      prompt: 'private input',
      providerKey: 'private key',
    } as GatewayAuditInput);
    await store.append({
      kind: 'auth-denied',
      requestId: 'request-2',
      token: 'private token',
    } as GatewayAuditInput);
    const result = await db.query<{
      kind: string;
      request_id: string;
      principal_id: string | null;
      credential_id: string | null;
      policy_versions: unknown;
      details: unknown;
    }>(
      'SELECT kind, request_id, principal_id, credential_id, policy_versions, details FROM gateway_audit_events ORDER BY event_id',
    );
    assert.deepEqual(result.rows, [
      {
        kind: 'models-listed',
        request_id: 'request-1',
        principal_id: 'service-1',
        credential_id: 'credential-1',
        policy_versions: [{ id: 'allow', version: 'v1' }],
        details: { count: 2 },
      },
      {
        kind: 'auth-denied',
        request_id: 'request-2',
        principal_id: null,
        credential_id: null,
        policy_versions: null,
        details: {},
      },
    ]);
    assert.equal(JSON.stringify(result.rows).includes('private'), false);
  } finally {
    await db.close();
  }
});

test('managed and delegated route events project bounded decision and attempt details', async () => {
  const { db, store } = await fixture();
  try {
    await store.append({
      ...attribution,
      kind: 'decision',
      requestId: 'request-3',
      routeVersion: 'v1',
      modelAlias: 'chat',
      candidateId: 'candidate-1',
      decision: {
        source: 'jev',
        model: 'jev-latest',
        confidence: 0.8,
        usage: { inputTokens: 1, outputTokens: 2, prompt: 'private input' },
        response: 'private response',
      },
      providerKey: 'private key',
    } as GatewayAuditInput);
    await store.append({
      ...attribution,
      kind: 'delegated-attempt',
      requestId: 'request-4',
      routeVersion: 'v2',
      modelAlias: 'chat',
      upstreamModelId: 'openai/gpt+large',
      candidateIds: ['candidate-1'],
      authorizedProviderSlugs: ['openai'],
      outcome: 'failed',
      failureCategory: 'upstream',
      possiblyBilled: true,
      upstreamErrorBody: 'private error',
    } as GatewayAuditInput);
    const result = await db.query<{ kind: string; details: unknown }>(
      'SELECT kind, details FROM gateway_audit_events ORDER BY event_id',
    );
    assert.deepEqual(result.rows, [
      {
        kind: 'decision',
        details: {
          routeVersion: 'v1',
          modelAlias: 'chat',
          candidateId: 'candidate-1',
          decision: {
            source: 'jev',
            model: 'jev-latest',
            confidence: 0.8,
            usage: { inputTokens: 1, outputTokens: 2 },
          },
        },
      },
      {
        kind: 'delegated-attempt',
        details: {
          routeVersion: 'v2',
          modelAlias: 'chat',
          upstreamModelId: 'openai/gpt+large',
          candidateIds: ['candidate-1'],
          authorizedProviderSlugs: ['openai'],
          outcome: 'failed',
          failureCategory: 'upstream',
          possiblyBilled: true,
        },
      },
    ]);
    assert.equal(JSON.stringify(result.rows).includes('private'), false);
  } finally {
    await db.close();
  }
});

test('unknown or malformed events fail before SQL without leaking input', async () => {
  const calls: unknown[] = [];
  const store = createPostgresGatewayAuditStore(
    {
      query: async (_sql, params) => {
        calls.push(params);
        return { rows: [{ event_id: 1 }] };
      },
    },
    () => 1_000,
  );
  for (const event of [
    { ...attribution, kind: 'unrecognized', requestId: 'request-5' },
    { ...attribution, kind: 'models-listed', requestId: 'request-5', count: -1 },
    {
      kind: 'decision',
      requestId: 'request-5',
      routeVersion: 'v1',
      modelAlias: 'chat',
      candidateId: 'candidate-1',
      decision: { source: 'jev', model: 'bad model', confidence: 0.8 },
    },
    {
      ...attribution,
      kind: 'decision',
      requestId: 'request-5',
      routeVersion: 'v1',
      modelAlias: 'chat',
      candidateId: 'candidate-1',
      decision: { source: 'other', model: 'jev-latest', confidence: 0.8 },
    },
  ]) {
    await assert.rejects(store.append(event as GatewayAuditInput), {
      name: 'InvalidGatewayAuditEvent',
      message: 'Invalid gateway audit event',
    });
  }
  assert.deepEqual(calls, []);
});

test('database failures become fixed safe errors', async () => {
  const store = createPostgresGatewayAuditStore(
    {
      query: async () => {
        throw new Error('private SQL detail');
      },
    },
    () => 1_000,
  );
  await assert.rejects(store.append({ kind: 'auth-denied', requestId: 'request-6' }), {
    name: 'GatewayAuditUnavailable',
    message: 'Gateway audit store unavailable',
  });

  const clock = createPostgresGatewayAuditStore(
    {
      query: async () => {
        throw new Error('SQL must not run');
      },
    },
    () => {
      throw new Error('private clock detail');
    },
  );
  await assert.rejects(clock.append({ kind: 'auth-denied', requestId: 'request-6' }), {
    name: 'GatewayAuditUnavailable',
    message: 'Gateway audit store unavailable',
  });
});

test('managed and delegated usage handoff failures retain distinct safe candidate shapes', () => {
  const common = {
    ...attribution,
    kind: 'usage-handoff-failed',
    requestId: 'request-7',
    routeVersion: 'v1',
    modelAlias: 'chat',
    attemptId: 'attempt-1',
    outcome: 'failed',
    possiblyBilled: true,
  } as const;
  const managed = projectGatewayAuditEvent({ ...common, candidateId: 'direct-1' }, 1_000);
  const delegated = projectGatewayAuditEvent({ ...common, candidateIds: ['router-1'] }, 1_000);
  assert.deepEqual(managed.details, {
    routeVersion: 'v1',
    modelAlias: 'chat',
    attemptId: 'attempt-1',
    candidateId: 'direct-1',
    outcome: 'failed',
    possiblyBilled: true,
  });
  assert.deepEqual(delegated.details, {
    routeVersion: 'v1',
    modelAlias: 'chat',
    attemptId: 'attempt-1',
    candidateIds: ['router-1'],
    outcome: 'failed',
    possiblyBilled: true,
  });
  assert.throws(() => projectGatewayAuditEvent(common, -1), { name: 'InvalidGatewayAuditEvent' });
});
