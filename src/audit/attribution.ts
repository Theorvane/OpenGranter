import type { PolicyVersion } from '../policy/evaluate-attachments.ts';

/** Nonsecret identity and policy references fixed for one authenticated request. */
export interface AuditAttribution {
  readonly principalId: string;
  readonly credentialId: string;
  readonly policyVersions: readonly PolicyVersion[];
}

export function validAuditAttribution(value: unknown): value is AuditAttribution {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.principalId === 'string' &&
    candidate.principalId.length > 0 &&
    typeof candidate.credentialId === 'string' &&
    candidate.credentialId.length > 0 &&
    Array.isArray(candidate.policyVersions) &&
    candidate.policyVersions.every(
      (policy: unknown) =>
        typeof policy === 'object' &&
        policy !== null &&
        'id' in policy &&
        typeof policy.id === 'string' &&
        policy.id.length > 0 &&
        'version' in policy &&
        typeof policy.version === 'string' &&
        policy.version.length > 0,
    )
  );
}
