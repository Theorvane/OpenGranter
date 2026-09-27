import {
  type PrincipalSnapshot,
  type RoleSnapshot,
  resolvePolicyAttachments,
  type VersionedPolicy,
} from '../policy/evaluate-attachments.ts';
import type { AuthenticatedPrincipal } from './chat-handler.ts';

export interface CredentialIdentity {
  readonly credentialId: string;
  readonly principalId: string;
  readonly active: boolean;
}

export interface IdentityAttachmentSnapshot {
  readonly principal: PrincipalSnapshot;
  readonly roles: readonly RoleSnapshot[];
  readonly policies: readonly VersionedPolicy[];
}

export interface AttachmentAuthenticatorPorts {
  readonly verifyCredential: (proxyToken: string) => Promise<CredentialIdentity | undefined>;
  readonly loadSnapshot: (principalId: string) => Promise<IdentityAttachmentSnapshot | undefined>;
}

/** Authenticate a credential and resolve every attached policy before gateway routing. */
export function createAttachmentAuthenticator(
  ports: AttachmentAuthenticatorPorts,
): (proxyToken: string) => Promise<AuthenticatedPrincipal | undefined> {
  return async (proxyToken) => {
    const identity = await ports.verifyCredential(proxyToken);
    if (!identity?.active || !identity.credentialId || !identity.principalId) return undefined;

    const snapshot = await ports.loadSnapshot(identity.principalId);
    if (!snapshot || snapshot.principal.id !== identity.principalId) {
      throw new Error('Identity attachment snapshot unavailable');
    }
    if (!snapshot.principal.active) return undefined;

    const resolved = resolvePolicyAttachments(snapshot);
    if (!resolved) return undefined;
    return {
      id: identity.principalId,
      active: true,
      statements: resolved.statements,
      credentialId: identity.credentialId,
      policyVersions: resolved.policyVersions,
    };
  };
}
