/** Explicit offline verification against frozen, externally prepared PR #1007 sources. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresAuditHistoryReader } from '../src/audit/postgres-audit-history.ts';
import { createPostgresGatewayAuditStore } from '../src/audit/postgres-gateway-audit.ts';

const corePath = resolve(process.argv[2] ?? 'missing-core-path');
for (const [name, expected] of [
  ['owned-route.ts', '8c95cad01a3239a2b2b506f4c0a13023a8c76fc935c909209c2ec275bef297a2'],
  ['owned-strategy.ts', '42dbc7f7bfdaea2eadd32a68f9d3f4386c3ccef489b3902bbaec064c2b61e937'],
] as const) {
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(dirname(corePath), name)))
      .digest('hex'),
    expected,
  );
}
const core = (await import(pathToFileURL(corePath).href)) as {
  invokeOwnedRoute(input: unknown): Promise<{ status: string; reason?: string }>;
};
for (const mode of ['success', 'sql-failure', 'acknowledgement-failure', 'denied'] as const) {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL('../migrations/003_gateway_audit.sql', import.meta.url), 'utf8'),
    );
    let selections = 0;
    let inferences = 0;
    let reconciliations = 0;
    let queries = 0;
    const store = createPostgresGatewayAuditStore(
      {
        query: async (sql, params) => {
          queries++;
          if (mode === 'sql-failure') throw new Error('synthetic private database failure');
          if (mode === 'acknowledgement-failure') return { rows: [] };
          return db.query(sql, [...params]);
        },
      },
      () => 1000,
    );
    const result = await core.invokeOwnedRoute({
      requestId: 'owned-request-1',
      principalId: 'person-1',
      credentialId: 'credential-1',
      policyVersions: [{ id: 'allow', version: 'v1' }],
      routeVersion: 'route-v1',
      modelAlias: 'chat',
      principalActive: true,
      statements: [
        { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
      ],
      candidates:
        mode === 'denied'
          ? []
          : [
              {
                id: 'candidate-1',
                registrationId: 'direct-1',
                providerId: 'openai',
                upstreamModelId: 'gpt-test',
                priority: 0,
                capabilityEligible: true,
                healthy: true,
                quotaEligible: true,
              },
            ],
      registrations: [{ id: 'direct-1', providerId: 'openai', kind: 'direct' }],
      strategy: {
        id: 'administrator-priority',
        async select() {
          selections++;
          return { candidateId: 'candidate-1' };
        },
      },
      ports: {
        // Test double only: this does not implement THE-18 reservations.
        reserve: async () => ({
          complete: async () => {
            reconciliations++;
          },
        }),
        writeUsage: async () => {},
        writeAudit: store.append,
        invokeDirect: async () => {
          inferences++;
          return 'offline fixture';
        },
        invokeOpenRouter: async () => {
          throw new Error('unexpected external inference');
        },
      },
    });
    const page = await createPostgresAuditHistoryReader({
      query: (sql, params) => db.query(sql, [...params]),
    })({ principalId: 'person-1', limit: 10 });
    if (mode === 'success') {
      assert.equal(result.status, 'invoked');
      assert.equal(selections, 1);
      assert.equal(inferences, 1);
      assert.deepEqual(
        page.events.map((event) => event.kind),
        ['attempt', 'decision', 'selection-started', 'owned-selection', 'owned-selection-started'],
      );
    } else if (mode === 'denied') {
      assert.deepEqual(result, { status: 'denied', reason: 'no-candidates' });
      assert.equal(page.events[0]?.kind, 'owned-denied');
      assert.equal(inferences, 0);
    } else {
      assert.deepEqual(result, { status: 'failed', reason: 'audit-unavailable' });
      assert.equal(queries, 1);
      assert.equal(selections, 0);
      assert.equal(inferences, 0);
      assert.equal(reconciliations, 1);
      assert.deepEqual(page.events, []);
    }
    console.log(
      JSON.stringify({
        mode,
        result: result.status,
        queries,
        selections,
        inferences,
        reconciliations,
        events: page.events.map((event) => event.kind),
      }),
    );
  } finally {
    await db.close();
  }
}
