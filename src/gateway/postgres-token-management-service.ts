import { createPostgresIdentitySnapshotStore } from '../identity/postgres-snapshots.ts';
import { resolvePolicyAttachments } from '../policy/evaluate-attachments.ts';
import type { CredentialSqlClient } from './postgres-proxy-credentials.ts';
import { createPostgresTokenManagementCoordinator } from './postgres-token-management.ts';
import {
  InvalidTokenManagementInput,
  type TokenManagementActor,
  TokenManagementUnavailable,
} from './token-management.ts';

interface ActorRequest {
  readonly authenticatedActorId: string;
  readonly requestId: string;
}

interface IssueRequest extends ActorRequest {
  readonly principalId: string;
  readonly expiresAt: number;
}

interface RevokeRequest extends ActorRequest {
  readonly credentialId: string;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function validActorRequest(value: unknown): value is ActorRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'authenticatedActorId' in value &&
    validId(value.authenticatedActorId) &&
    'requestId' in value &&
    validId(value.requestId)
  );
}

/** Internal boundary: actor IDs must come from trusted prior authentication. */
export function createPostgresTokenManagementService(ports: {
  readonly client: CredentialSqlClient;
  readonly now: () => number;
}) {
  const identities = createPostgresIdentitySnapshotStore(ports.client);
  const coordinator = createPostgresTokenManagementCoordinator(ports);

  async function resolveActor(id: string): Promise<TokenManagementActor> {
    try {
      const snapshot = await identities.loadSnapshot(id);
      if (!snapshot?.principal.active) {
        return { id, active: false, statements: [], policyVersions: [] };
      }
      const resolved = resolvePolicyAttachments(snapshot);
      if (!resolved) throw new TokenManagementUnavailable();
      return {
        id: snapshot.principal.id,
        active: true,
        statements: resolved.statements,
        policyVersions: resolved.policyVersions,
      };
    } catch {
      throw new TokenManagementUnavailable();
    }
  }

  return {
    async issue(input: IssueRequest) {
      if (
        !validActorRequest(input) ||
        !validId(input.principalId) ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt < 0
      ) {
        throw new InvalidTokenManagementInput();
      }
      const { authenticatedActorId, requestId, principalId, expiresAt } = input;
      const actor = await resolveActor(authenticatedActorId);
      return coordinator.issue({
        actor,
        requestId,
        principalId,
        expiresAt,
      });
    },
    async revoke(input: RevokeRequest): Promise<boolean> {
      if (!validActorRequest(input) || !validId(input.credentialId)) {
        throw new InvalidTokenManagementInput();
      }
      const { authenticatedActorId, requestId, credentialId } = input;
      const actor = await resolveActor(authenticatedActorId);
      return coordinator.revoke({
        actor,
        requestId,
        credentialId,
      });
    },
  };
}
