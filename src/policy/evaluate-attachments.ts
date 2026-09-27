import { type DecisionReason, type Effect, evaluate, type Statement } from './evaluate.ts';

export interface PrincipalSnapshot {
  readonly id: string;
  readonly kind: 'human' | 'service';
  readonly active: boolean;
  readonly directPolicyIds: readonly string[];
  readonly roleIds: readonly string[];
}

export interface RoleSnapshot {
  readonly id: string;
  readonly policyIds: readonly string[];
}

export interface VersionedPolicy {
  readonly id: string;
  readonly version: string;
  readonly statements: readonly Statement[];
}

export interface AttachmentInput {
  readonly principal: PrincipalSnapshot;
  readonly roles: readonly RoleSnapshot[];
  readonly policies: readonly VersionedPolicy[];
  readonly action: string;
  readonly resource: string;
}

export interface PolicyVersion {
  readonly id: string;
  readonly version: string;
}

export interface AttachmentDecision {
  readonly effect: Effect;
  readonly reason: DecisionReason | 'unresolved-attachment';
  readonly policyVersions: readonly PolicyVersion[];
}

function oneRecord<T extends { readonly id: string }>(records: readonly T[], id: string): T | null {
  if (id.length === 0) return null;
  let found: T | null = null;
  for (const record of records) {
    if (record.id !== id) continue;
    if (found !== null) return null;
    found = record;
  }
  return found;
}

const unresolved: AttachmentDecision = {
  effect: 'Deny',
  reason: 'unresolved-attachment',
  policyVersions: [],
};

/** Evaluate a trusted attachment snapshot; authentication must happen before this call. */
export function evaluateAttachments(input: AttachmentInput): AttachmentDecision {
  if (!input.principal.active) {
    return {
      ...evaluate({
        principalActive: false,
        action: input.action,
        resource: input.resource,
        statements: [],
      }),
      policyVersions: [],
    };
  }

  const policyIds = [...input.principal.directPolicyIds];
  for (const roleId of new Set(input.principal.roleIds)) {
    const role = oneRecord(input.roles, roleId);
    if (role === null) return unresolved;
    policyIds.push(...role.policyIds);
  }

  const policies: VersionedPolicy[] = [];
  for (const policyId of new Set(policyIds)) {
    const policy = oneRecord(input.policies, policyId);
    if (policy === null || policy.version.length === 0) return unresolved;
    policies.push(policy);
  }

  const decision = evaluate({
    principalActive: true,
    action: input.action,
    resource: input.resource,
    statements: policies.flatMap((policy) => policy.statements),
  });
  return {
    ...decision,
    policyVersions: policies.map(({ id, version }) => ({ id, version })),
  };
}
