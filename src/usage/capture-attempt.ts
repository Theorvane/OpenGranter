import type { AuditAttribution } from '../audit/attribution.ts';
import type { RouteKind } from '../routing/authorize-candidates.ts';
import { buildUsageRecord, type UsageRecord } from './record-usage.ts';

export interface UsageHandoff {
  /** Must append idempotently by attempt ID or durably enqueue for recovery. */
  readonly writeUsage?: (record: UsageRecord) => Promise<void>;
  readonly now?: () => number;
}

export interface AttemptUsageInput extends AuditAttribution {
  readonly requestId: string;
  readonly attemptNumber: number;
  readonly modelAlias: string;
  readonly routeKind: RouteKind;
  readonly upstreamModelId: string;
  readonly selectedCandidateId: string | null;
  readonly actualInferenceProviderId?: string;
  readonly startedAt: number;
  readonly outcome: 'succeeded' | 'failed';
  readonly possiblyBilled: boolean;
  readonly possibleDuplicate: boolean;
  readonly response?: unknown;
}

function providerUsage(response: unknown): unknown {
  if (typeof response !== 'object' || response === null || Array.isArray(response))
    return undefined;
  return (response as Record<string, unknown>).usage;
}

/** Copy allowlisted metadata into one per-attempt accounting handoff. */
export async function captureAttemptUsage(
  input: AttemptUsageInput,
  ports: UsageHandoff,
): Promise<void> {
  if (!ports.writeUsage) return;
  const endedAt = ports.now?.() ?? Date.now();
  const record = buildUsageRecord({
    principalId: input.principalId,
    credentialId: input.credentialId,
    policyVersions: input.policyVersions,
    requestId: input.requestId,
    attemptId: `${input.requestId}/${input.routeKind}/${input.attemptNumber}`,
    modelAlias: input.modelAlias,
    routeKind: input.routeKind,
    upstreamModelId: input.upstreamModelId,
    selectedCandidateId: input.selectedCandidateId,
    ...(input.actualInferenceProviderId
      ? { actualInferenceProviderId: input.actualInferenceProviderId }
      : {}),
    occurredAt: input.startedAt,
    latencyMs: Math.max(0, endedAt - input.startedAt),
    outcome: input.outcome,
    possiblyBilled: input.possiblyBilled,
    possibleDuplicate: input.possibleDuplicate,
    providerUsage: input.outcome === 'succeeded' ? providerUsage(input.response) : undefined,
  });
  await ports.writeUsage(record);
}
