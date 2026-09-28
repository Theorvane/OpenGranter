import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authorizeCandidates,
  authorizedProviderIdsForModel,
  type RouteCandidate,
} from '../src/routing/authorize-candidates.ts';
import { invokeDelegatedRoute } from '../src/routing/invoke-delegated-route.ts';
import {
  DirectProviderFailure,
  invokeManagedRoute,
} from '../src/routing/invoke-jev-managed-route.ts';
import { selectAuthorizedManagedCandidate } from '../src/routing/select-managed-candidate.ts';

const statements = [
  { effect: 'Allow' as const, actions: ['llm:InvokeModel'], resources: ['model:chat'] },
  {
    effect: 'Allow' as const,
    actions: ['llm:UseProvider'],
    resources: ['provider:openai', 'provider:anthropic'],
  },
  { effect: 'Deny' as const, actions: ['llm:UseProvider'], resources: ['provider:forbidden'] },
];
const base = {
  principalActive: true,
  principalId: 'user-1',
  credentialId: 'credential-1',
  policyVersions: [],
  modelAlias: 'chat',
  requestId: 'snapshot-1',
  routeVersion: 'v1',
  statements,
  request: { model: 'chat', messages: [{ role: 'user' as const, content: 'fixture' }] },
};
function candidate(id: string, providerId: string, kind: 'managed' | 'delegated' = 'managed') {
  return { id, kind, providerId, upstreamModelId: 'approved/model' };
}

test('source mutation/replacement cannot change evaluated destination snapshots or grouping', () => {
  const source = candidate('one', 'openai');
  const expected = { ...source };
  const sources = [source];
  const result = authorizeCandidates({ ...base, routeKind: 'managed', candidates: sources });
  Object.assign(source, {
    id: 'changed',
    kind: 'delegated',
    providerId: 'forbidden',
    upstreamModelId: 'other/model',
  });
  sources[0] = candidate('new', 'anthropic');
  sources.push(candidate('later', 'anthropic'));
  assert.deepEqual(result.candidates, [expected]);
  assert.deepEqual(authorizedProviderIdsForModel(result, 'approved/model'), ['openai']);
  assert.deepEqual(authorizedProviderIdsForModel(result, 'other/model'), []);
});

test('returned fields, arrays and result are immutable and unrelated runtime data is stripped', () => {
  const source = {
    ...candidate('one', 'openai'),
    token: 'private-fixture',
    prompt: 'private-content',
  };
  const result = authorizeCandidates({ ...base, routeKind: 'managed', candidates: [source] });
  assert.deepEqual(result.candidates, [candidate('one', 'openai')]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.candidates));
  const selected = result.candidates[0];
  assert.ok(selected);
  assert.ok(Object.isFrozen(selected));
  assert.throws(() => Object.assign(selected, { providerId: 'forbidden' }), TypeError);
  assert.throws(
    () => (result.candidates as RouteCandidate[]).push(candidate('new', 'forbidden')),
    TypeError,
  );
  const denied = authorizeCandidates({
    ...base,
    principalActive: false,
    routeKind: 'managed',
    candidates: [source],
  });
  assert.deepEqual(denied.candidates, []);
  assert.ok(Object.isFrozen(denied.candidates));
});

test('async selector source updates cannot replace the evaluated chosen ID/provider/model', async () => {
  const source = candidate('one', 'openai');
  const expected = { ...source };
  const result = await selectAuthorizedManagedCandidate({
    ...base,
    candidates: [source],
    select: async () => {
      Object.assign(source, {
        id: 'changed',
        providerId: 'forbidden',
        upstreamModelId: 'other/model',
      });
      return 'one';
    },
  });
  assert.deepEqual(result, { status: 'selected', candidate: expected });
});

test('managed limit/configuration updates cannot alter selected and fallback destinations or audits', async () => {
  const sources = [candidate('one', 'openai'), candidate('two', 'anthropic')];
  const expected = sources.map((source) => ({ ...source }));
  const calls: RouteCandidate[] = [];
  const events: unknown[] = [];
  const result = await invokeManagedRoute({
    ...base,
    candidates: sources,
    ports: {
      checkLimit: async () => {
        for (const source of sources)
          Object.assign(source, {
            id: `changed-${source.id}`,
            providerId: 'forbidden',
            upstreamModelId: 'other/model',
            kind: 'delegated',
          });
        return true;
      },
      resolveSecret: async () => {
        throw new Error('unexpected Jev');
      },
      writeAudit: async (event) => {
        events.push(event);
      },
      writeUsage: async () => {},
      now: () => 1000,
      invokeDirect: async (selected) => {
        calls.push(selected);
        if (calls.length === 1) throw new DirectProviderFailure('timeout', false, false);
        return { id: 'completion' };
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(calls, expected);
  if (result.status === 'invoked') assert.deepEqual(result.candidate, expected[1]);
  const encoded = JSON.stringify(events);
  assert.equal(encoded.includes('changed-'), false);
  assert.equal(encoded.includes('other/model'), false);
  assert.equal(encoded.includes('forbidden'), false);
});

test('delegated mapping callback updates cannot introduce a different provider or audit candidate', async () => {
  const sources = [
    candidate('one', 'openai', 'delegated'),
    candidate('two', 'anthropic', 'delegated'),
  ];
  const mappings: string[][] = [];
  const events: unknown[] = [];
  let attempt: unknown;
  const result = await invokeDelegatedRoute({
    ...base,
    candidates: sources,
    credentialRef: 'secret/openrouter',
    ports: {
      resolveVerifiedProviderSlug: async (provider, model) => {
        mappings.push([provider, model]);
        for (const source of sources)
          Object.assign(source, {
            id: `changed-${source.id}`,
            providerId: 'forbidden',
            upstreamModelId: 'other/model',
          });
        return provider === 'openai'
          ? 'openai'
          : provider === 'anthropic'
            ? 'anthropic'
            : 'forbidden';
      },
      checkLimit: async () => true,
      writeAudit: async (event) => {
        events.push(event);
      },
      writeUsage: async () => {},
      now: () => 1000,
      invokeOpenRouter: async (_ref, selected) => {
        attempt = selected;
        return { id: 'completion' };
      },
    },
  });
  assert.equal(result.status, 'invoked');
  assert.deepEqual(mappings, [
    ['openai', 'approved/model'],
    ['anthropic', 'approved/model'],
  ]);
  assert.deepEqual(attempt, {
    upstreamModelId: 'approved/model',
    authorizedProviderSlugs: ['openai', 'anthropic'],
  });
  assert.equal(JSON.stringify(events).includes('changed-'), false);
});

test('denials and kind/order filtering remain unchanged with projected snapshots', () => {
  const sources = [
    candidate('denied', 'forbidden'),
    candidate('one', 'openai'),
    candidate('delegated', 'openai', 'delegated'),
    candidate('two', 'anthropic'),
  ];
  assert.deepEqual(
    authorizeCandidates({ ...base, routeKind: 'managed', candidates: sources }).candidates,
    [sources[1], sources[3]],
  );
  for (const change of [{ principalActive: false }, { statements: [] }, { modelAlias: 'other' }]) {
    assert.deepEqual(
      authorizeCandidates({ ...base, ...change, routeKind: 'managed', candidates: sources })
        .candidates,
      [],
    );
  }
});
