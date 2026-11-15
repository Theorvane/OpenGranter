import { validAuditAttribution } from './attribution.ts';
import { buildUsageRecord, InvalidUsageRecordInput, type UsageRecord } from './record-usage.ts';

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Validate a ledger row and copy only the known content-free contract. */
export function parseStoredUsageRecord(value: unknown): UsageRecord {
  const stored = object(value);
  const usage = object(stored?.usage);
  if (
    !stored ||
    !validAuditAttribution(stored) ||
    !nonempty(stored.requestId) ||
    !nonempty(stored.attemptId) ||
    !nonempty(stored.modelAlias) ||
    (stored.routeKind !== 'managed' && stored.routeKind !== 'delegated') ||
    !nonempty(stored.upstreamModelId) ||
    (stored.selectedCandidateId !== null && !nonempty(stored.selectedCandidateId)) ||
    (stored.actualInferenceProviderId !== null && !nonempty(stored.actualInferenceProviderId)) ||
    !count(stored.occurredAt) ||
    !count(stored.latencyMs) ||
    (stored.outcome !== 'succeeded' && stored.outcome !== 'failed') ||
    typeof stored.possiblyBilled !== 'boolean' ||
    typeof stored.possibleDuplicate !== 'boolean' ||
    !usage ||
    !['reported', 'partial', 'missing', 'invalid'].includes(String(usage.status)) ||
    !['promptTokens', 'completionTokens', 'totalTokens'].every(
      (key) => usage[key] === null || count(usage[key]),
    )
  ) {
    throw new InvalidUsageRecordInput();
  }

  const providerUsage: Record<string, unknown> = {};
  if (usage.status === 'invalid') {
    providerUsage.prompt_tokens = -1;
  } else {
    if (usage.promptTokens !== null) providerUsage.prompt_tokens = usage.promptTokens;
    if (usage.completionTokens !== null) providerUsage.completion_tokens = usage.completionTokens;
    if (usage.totalTokens !== null) providerUsage.total_tokens = usage.totalTokens;
  }
  const normalized = buildUsageRecord({
    principalId: stored.principalId,
    credentialId: stored.credentialId,
    policyVersions: stored.policyVersions,
    requestId: stored.requestId,
    attemptId: stored.attemptId,
    modelAlias: stored.modelAlias,
    routeKind: stored.routeKind,
    upstreamModelId: stored.upstreamModelId,
    selectedCandidateId: stored.selectedCandidateId,
    ...(stored.actualInferenceProviderId === null
      ? {}
      : { actualInferenceProviderId: stored.actualInferenceProviderId }),
    occurredAt: stored.occurredAt,
    latencyMs: stored.latencyMs,
    outcome: stored.outcome,
    possiblyBilled: stored.possiblyBilled,
    possibleDuplicate: stored.possibleDuplicate,
    providerUsage,
    estimatedCost: stored.estimatedCost,
    upstreamBilledCost: stored.upstreamBilledCost,
  });
  if (
    normalized.usage.status !== usage.status ||
    normalized.usage.promptTokens !== usage.promptTokens ||
    normalized.usage.completionTokens !== usage.completionTokens ||
    normalized.usage.totalTokens !== usage.totalTokens
  ) {
    throw new InvalidUsageRecordInput();
  }
  return normalized;
}
