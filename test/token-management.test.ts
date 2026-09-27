import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTokenManagementCoordinator } from '../src/gateway/token-management.ts';

const actor = {
  id: 'admin-1',
  active: true,
  statements: [
    { effect: 'Allow' as const, actions: ['iam:Manage'], resources: ['principal:service-1'] },
  ],
  policyVersions: [{ id: 'manage-service-1', version: 'v1' }],
};

function harness(
  options: {
    owner?: string | undefined;
    lookupFails?: boolean;
    auditFails?: boolean;
    issueFails?: boolean;
    revokeFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const events: unknown[] = [];
  const coordinator = createTokenManagementCoordinator({
    findOwner: async (credentialId) => {
      calls.push(`lookup:${credentialId}`);
      if (options.lookupFails) throw new Error('sensitive database detail');
      return 'owner' in options ? options.owner : 'service-1';
    },
    issueToken: async (input) => {
      calls.push(`issue:${input.principalId}:${input.actorId}`);
      if (options.issueFails) throw new Error('sensitive token-store detail');
      return { credentialId: 'credential-1', token: 'secret-token' };
    },
    revokeToken: async (input) => {
      calls.push(`revoke:${input.credentialId}:${input.actorId}`);
      if (options.revokeFails) throw new Error('sensitive token-store detail');
      return true;
    },
    writeAudit: async (event) => {
      calls.push('audit');
      if (options.auditFails) throw new Error('sensitive audit detail');
      events.push(event);
    },
  });
  return { coordinator, calls, events };
}

test('permitted actor issues for the target after a nonsecret decision audit', async () => {
  const { coordinator, calls, events } = harness();
  const issued = await coordinator.issue({
    actor,
    requestId: 'req-1',
    principalId: 'service-1',
    expiresAt: 10_000,
  });
  assert.deepEqual(issued, { credentialId: 'credential-1', token: 'secret-token' });
  assert.deepEqual(calls, ['audit', 'issue:service-1:admin-1']);
  assert.deepEqual(events, [
    {
      kind: 'token-management-allowed',
      operation: 'issue',
      requestId: 'req-1',
      actorId: 'admin-1',
      targetPrincipalId: 'service-1',
      policyVersions: [{ id: 'manage-service-1', version: 'v1' }],
    },
  ]);
  assert.equal(JSON.stringify(events).includes('secret-token'), false);
});

test('default and explicit Deny prevent issuance before the token service runs', async () => {
  for (const statements of [
    [],
    [
      ...actor.statements,
      { effect: 'Deny' as const, actions: ['iam:Manage'], resources: ['principal:service-1'] },
    ],
  ]) {
    const { coordinator, calls, events } = harness();
    await assert.rejects(
      coordinator.issue({
        actor: { ...actor, statements },
        requestId: 'req-2',
        principalId: 'service-1',
        expiresAt: 10_000,
      }),
      { name: 'TokenManagementDenied' },
    );
    assert.deepEqual(calls, ['audit']);
    assert.equal((events[0] as { kind: string }).kind, 'token-management-denied');
  }
});

test('inactive or malformed actors cannot manage a token', async () => {
  const { coordinator, calls } = harness();
  await assert.rejects(
    coordinator.issue({
      actor: { ...actor, active: false },
      requestId: 'req-3',
      principalId: 'service-1',
      expiresAt: 10_000,
    }),
    { name: 'TokenManagementDenied' },
  );
  assert.deepEqual(calls, ['audit']);
  await assert.rejects(
    coordinator.issue({
      actor: { ...actor, id: '' },
      requestId: 'req-4',
      principalId: 'service-1',
      expiresAt: 10_000,
    }),
    { name: 'InvalidTokenManagementInput' },
  );
  assert.deepEqual(calls, ['audit']);
});

test('revoke evaluates the stored owner rather than a caller claim', async () => {
  const { coordinator, calls, events } = harness();
  assert.equal(
    await coordinator.revoke({ actor, requestId: 'req-5', credentialId: 'credential-1' }),
    true,
  );
  assert.deepEqual(calls, ['lookup:credential-1', 'audit', 'revoke:credential-1:admin-1']);
  assert.deepEqual(events, [
    {
      kind: 'token-management-allowed',
      operation: 'revoke',
      requestId: 'req-5',
      actorId: 'admin-1',
      targetPrincipalId: 'service-1',
      credentialId: 'credential-1',
      policyVersions: [{ id: 'manage-service-1', version: 'v1' }],
    },
  ]);

  const wrongOwner = harness({ owner: 'service-2' });
  await assert.rejects(
    wrongOwner.coordinator.revoke({
      actor,
      requestId: 'req-6',
      credentialId: 'credential-2',
    }),
    { name: 'TokenManagementDenied' },
  );
  assert.deepEqual(wrongOwner.calls, ['lookup:credential-2', 'audit']);
  assert.equal(
    (wrongOwner.events[0] as { targetPrincipalId: string }).targetPrincipalId,
    'service-2',
  );
});

test('unknown credential denies without mutation or owner disclosure', async () => {
  const { coordinator, calls, events } = harness({ owner: undefined });
  await assert.rejects(
    coordinator.revoke({
      actor,
      requestId: 'req-7',
      credentialId: 'missing',
    }),
    { name: 'TokenManagementDenied' },
  );
  assert.deepEqual(calls, ['lookup:missing', 'audit']);
  assert.equal((events[0] as { targetPrincipalId: unknown }).targetPrincipalId, null);
});

test('lookup and decision-audit failures fail closed with safe errors', async () => {
  const lookup = harness({ lookupFails: true });
  await assert.rejects(
    lookup.coordinator.revoke({
      actor,
      requestId: 'req-8',
      credentialId: 'credential-1',
    }),
    { name: 'TokenManagementUnavailable', message: 'Token management unavailable' },
  );
  assert.deepEqual(lookup.calls, ['lookup:credential-1']);

  const audit = harness({ auditFails: true });
  await assert.rejects(
    audit.coordinator.issue({
      actor,
      requestId: 'req-9',
      principalId: 'service-1',
      expiresAt: 10_000,
    }),
    { name: 'TokenManagementUnavailable', message: 'Token management unavailable' },
  );
  assert.deepEqual(audit.calls, ['audit']);

  const revokeAudit = harness({ auditFails: true });
  await assert.rejects(
    revokeAudit.coordinator.revoke({ actor, requestId: 'req-10', credentialId: 'credential-1' }),
    { name: 'TokenManagementUnavailable', message: 'Token management unavailable' },
  );
  assert.deepEqual(revokeAudit.calls, ['lookup:credential-1', 'audit']);
});

test('credential mutation failures expose no underlying storage detail', async () => {
  const issue = harness({ issueFails: true });
  await assert.rejects(
    issue.coordinator.issue({
      actor,
      requestId: 'req-11',
      principalId: 'service-1',
      expiresAt: 10_000,
    }),
    { name: 'TokenManagementUnavailable', message: 'Token management unavailable' },
  );
  assert.deepEqual(issue.calls, ['audit', 'issue:service-1:admin-1']);

  const revoke = harness({ revokeFails: true });
  await assert.rejects(
    revoke.coordinator.revoke({ actor, requestId: 'req-12', credentialId: 'credential-1' }),
    { name: 'TokenManagementUnavailable', message: 'Token management unavailable' },
  );
  assert.deepEqual(revoke.calls, ['lookup:credential-1', 'audit', 'revoke:credential-1:admin-1']);
});
