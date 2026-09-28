import { evaluate, type Statement } from '../policy/evaluate.ts';
import type { PolicyVersion } from '../policy/evaluate-attachments.ts';

export interface TokenManagementActor {
  readonly id: string;
  readonly active: boolean;
  readonly statements: readonly Statement[];
  readonly policyVersions: readonly PolicyVersion[];
}

export interface TokenManagementAuditEvent {
  readonly kind: 'token-management-allowed' | 'token-management-denied';
  readonly operation: 'issue' | 'revoke';
  readonly requestId: string;
  readonly actorId: string;
  readonly targetPrincipalId: string | null;
  readonly credentialId?: string;
  readonly policyVersions: readonly PolicyVersion[];
}

export class TokenManagementDenied extends Error {
  constructor() {
    super('Token management denied');
    this.name = 'TokenManagementDenied';
  }
}

export class TokenManagementUnavailable extends Error {
  constructor() {
    super('Token management unavailable');
    this.name = 'TokenManagementUnavailable';
  }
}

export class InvalidTokenManagementInput extends Error {
  constructor() {
    super('Invalid token management input');
    this.name = 'InvalidTokenManagementInput';
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function validActor(value: unknown): value is TokenManagementActor {
  if (typeof value !== 'object' || value === null) return false;
  const actor = value as Record<string, unknown>;
  return (
    validId(actor.id) &&
    typeof actor.active === 'boolean' &&
    Array.isArray(actor.statements) &&
    actor.statements.every(
      (statement: unknown) =>
        typeof statement === 'object' &&
        statement !== null &&
        'effect' in statement &&
        (statement.effect === 'Allow' || statement.effect === 'Deny') &&
        'actions' in statement &&
        Array.isArray(statement.actions) &&
        statement.actions.every((action: unknown) => typeof action === 'string') &&
        'resources' in statement &&
        Array.isArray(statement.resources) &&
        statement.resources.every((resource: unknown) => typeof resource === 'string'),
    ) &&
    Array.isArray(actor.policyVersions) &&
    actor.policyVersions.every(
      (policy: unknown) =>
        typeof policy === 'object' &&
        policy !== null &&
        'id' in policy &&
        validId(policy.id) &&
        'version' in policy &&
        validId(policy.version),
    )
  );
}

function snapshotActor(actor: TokenManagementActor): TokenManagementActor {
  return Object.freeze({
    id: actor.id,
    active: actor.active,
    statements: Object.freeze(
      actor.statements.map((statement) =>
        Object.freeze({
          effect: statement.effect,
          actions: Object.freeze([...statement.actions]),
          resources: Object.freeze([...statement.resources]),
        }),
      ),
    ),
    policyVersions: Object.freeze(
      actor.policyVersions.map((policy) =>
        Object.freeze({
          id: policy.id,
          version: policy.version,
        }),
      ),
    ),
  });
}

/** A trusted caller supplies authenticated actor context; it never comes from the request body. */
export function createTokenManagementCoordinator(ports: {
  readonly findOwner: (credentialId: string) => Promise<string | undefined>;
  readonly issueToken: (input: {
    readonly principalId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly expiresAt: number;
  }) => Promise<{ readonly credentialId: string; readonly token: string }>;
  readonly revokeToken: (input: {
    readonly credentialId: string;
    readonly actorId: string;
    readonly requestId: string;
  }) => Promise<boolean>;
  readonly writeAudit: (event: TokenManagementAuditEvent) => Promise<void>;
}) {
  async function audit(event: TokenManagementAuditEvent): Promise<void> {
    try {
      await ports.writeAudit(Object.freeze(event));
    } catch {
      throw new TokenManagementUnavailable();
    }
  }

  async function decide(
    actor: TokenManagementActor,
    requestId: string,
    operation: 'issue' | 'revoke',
    targetPrincipalId: string | null,
    credentialId?: string,
  ): Promise<void> {
    const allowed =
      targetPrincipalId !== null &&
      evaluate({
        principalActive: actor.active,
        action: 'iam:Manage',
        resource: `principal:${targetPrincipalId}`,
        statements: actor.statements,
      }).effect === 'Allow';
    await audit({
      kind: allowed ? 'token-management-allowed' : 'token-management-denied',
      operation,
      requestId,
      actorId: actor.id,
      targetPrincipalId,
      ...(credentialId === undefined ? {} : { credentialId }),
      policyVersions: actor.policyVersions,
    });
    if (!allowed) throw new TokenManagementDenied();
  }

  return {
    async issue(input: {
      readonly actor: TokenManagementActor;
      readonly requestId: string;
      readonly principalId: string;
      readonly expiresAt: number;
    }) {
      if (
        !validActor(input.actor) ||
        !validId(input.requestId) ||
        !validId(input.principalId) ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt < 0
      ) {
        throw new InvalidTokenManagementInput();
      }
      const actor = snapshotActor(input.actor);
      const { requestId, principalId, expiresAt } = input;
      await decide(actor, requestId, 'issue', principalId);
      try {
        return await ports.issueToken({
          principalId,
          actorId: actor.id,
          requestId,
          expiresAt,
        });
      } catch {
        throw new TokenManagementUnavailable();
      }
    },
    async revoke(input: {
      readonly actor: TokenManagementActor;
      readonly requestId: string;
      readonly credentialId: string;
    }): Promise<boolean> {
      if (!validActor(input.actor) || !validId(input.requestId) || !validId(input.credentialId)) {
        throw new InvalidTokenManagementInput();
      }
      const actor = snapshotActor(input.actor);
      const { requestId, credentialId } = input;
      let owner: string | undefined;
      if (actor.active) {
        try {
          owner = await ports.findOwner(credentialId);
        } catch {
          throw new TokenManagementUnavailable();
        }
        if (owner !== undefined && !validId(owner)) throw new TokenManagementUnavailable();
      }
      await decide(actor, requestId, 'revoke', owner ?? null, credentialId);
      try {
        return await ports.revokeToken({
          credentialId,
          actorId: actor.id,
          requestId,
        });
      } catch {
        throw new TokenManagementUnavailable();
      }
    },
  };
}
