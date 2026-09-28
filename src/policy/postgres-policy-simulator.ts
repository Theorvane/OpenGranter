import {
  createPostgresIdentitySnapshotStore,
  type IdentitySnapshotSqlClient,
} from '../identity/postgres-snapshots.ts';
import { type AttachmentDecision, evaluateAttachments } from './evaluate-attachments.ts';

export interface PolicySimulationInput {
  readonly principalId: string;
  readonly action: string;
  readonly resource: string;
}

export class InvalidPolicySimulationInput extends Error {
  constructor() {
    super('Invalid policy simulation input');
    this.name = 'InvalidPolicySimulationInput';
  }
}

export class PolicySimulationUnavailable extends Error {
  constructor() {
    super('Policy simulation unavailable');
    this.name = 'PolicySimulationUnavailable';
  }
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validInput(value: unknown): value is PolicySimulationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    validText(input.principalId, 256) &&
    validText(input.action, 512) &&
    validText(input.resource, 512)
  );
}

/** Trusted internal diagnostic: caller restricts access; a simulated Allow never grants execution. */
export function createPostgresPolicySimulator(
  client: IdentitySnapshotSqlClient,
): (input: PolicySimulationInput) => Promise<AttachmentDecision | undefined> {
  const identities = createPostgresIdentitySnapshotStore(client);
  return async (input) => {
    if (!validInput(input)) throw new InvalidPolicySimulationInput();
    const { principalId, action, resource } = input;
    try {
      const snapshot = await identities.loadSnapshot(principalId);
      if (!snapshot) return undefined;
      return evaluateAttachments({
        principal: snapshot.principal,
        roles: snapshot.roles,
        policies: snapshot.policies,
        action,
        resource,
      });
    } catch {
      throw new PolicySimulationUnavailable();
    }
  };
}
