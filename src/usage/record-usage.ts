import { type AuditAttribution, validAuditAttribution } from '../audit/attribution.ts';
import type { RouteKind } from '../routing/authorize-candidates.ts';

export type UsageAvailability = 'reported' | 'partial' | 'missing' | 'invalid';

export interface TokenUsage {
  readonly status: UsageAvailability;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

export interface EstimatedCost {
  readonly amountDecimal: string;
  readonly currency: string;
  readonly priceVersion: string;
}

export interface UpstreamBilledCost {
  readonly amountDecimal: string;
  readonly currency: string;
  readonly source: 'openrouter' | 'direct-provider';
}

export interface UsageRecord extends AuditAttribution {
  readonly requestId: string;
  readonly attemptId: string;
  readonly modelAlias: string;
  readonly routeKind: RouteKind;
  readonly upstreamModelId: string;
  readonly selectedCandidateId: string;
  readonly actualInferenceProviderId: string | null;
  readonly occurredAt: number;
  readonly latencyMs: number;
  readonly outcome: 'succeeded' | 'failed';
  readonly possiblyBilled: boolean;
  readonly possibleDuplicate: boolean;
  readonly usage: TokenUsage;
  readonly estimatedCost: EstimatedCost | null;
  readonly upstreamBilledCost: UpstreamBilledCost | null;
}

export interface BuildUsageRecordInput extends AuditAttribution {
  readonly requestId: string;
  readonly attemptId: string;
  readonly modelAlias: string;
  readonly routeKind: RouteKind;
  readonly upstreamModelId: string;
  readonly selectedCandidateId: string;
  readonly actualInferenceProviderId?: string | undefined;
  readonly occurredAt: number;
  readonly latencyMs: number;
  readonly outcome: 'succeeded' | 'failed';
  readonly possiblyBilled: boolean;
  readonly possibleDuplicate: boolean;
  readonly providerUsage?: unknown;
  readonly estimatedCost?: unknown;
  readonly upstreamBilledCost?: unknown;
}

export class InvalidUsageRecordInput extends Error {
  constructor() {
    super('Invalid usage record input');
    this.name = 'InvalidUsageRecordInput';
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decimalAmount(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
  );
}

function moneyBase(value: Record<string, unknown>): boolean {
  return (
    decimalAmount(value.amountDecimal) &&
    typeof value.currency === 'string' &&
    /^[A-Z]{3}$/u.test(value.currency)
  );
}

function estimate(value: unknown): EstimatedCost | null {
  if (value === undefined || value === null) return null;
  const candidate = record(value);
  if (!candidate || !moneyBase(candidate) || !nonempty(candidate.priceVersion)) {
    throw new InvalidUsageRecordInput();
  }
  return {
    amountDecimal: candidate.amountDecimal as string,
    currency: candidate.currency as string,
    priceVersion: candidate.priceVersion,
  };
}

function billed(value: unknown): UpstreamBilledCost | null {
  if (value === undefined || value === null) return null;
  const candidate = record(value);
  if (
    !candidate ||
    !moneyBase(candidate) ||
    (candidate.source !== 'openrouter' && candidate.source !== 'direct-provider')
  ) {
    throw new InvalidUsageRecordInput();
  }
  return {
    amountDecimal: candidate.amountDecimal as string,
    currency: candidate.currency as string,
    source: candidate.source,
  };
}

function tokens(value: unknown): TokenUsage {
  const unknownCounts = { promptTokens: null, completionTokens: null, totalTokens: null } as const;
  if (value === undefined || value === null) return { status: 'missing', ...unknownCounts };
  const candidate = record(value);
  if (!candidate) return { status: 'invalid', ...unknownCounts };
  const keys = ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const;
  const present = keys.filter((key) => Object.hasOwn(candidate, key));
  if (present.length === 0) return { status: 'missing', ...unknownCounts };
  if (present.some((key) => !nonnegativeInteger(candidate[key]))) {
    return { status: 'invalid', ...unknownCounts };
  }
  return {
    status: present.length === keys.length ? 'reported' : 'partial',
    promptTokens: nonnegativeInteger(candidate.prompt_tokens) ? candidate.prompt_tokens : null,
    completionTokens: nonnegativeInteger(candidate.completion_tokens)
      ? candidate.completion_tokens
      : null,
    totalTokens: nonnegativeInteger(candidate.total_tokens) ? candidate.total_tokens : null,
  };
}

/** Build one content-free attempt record; persistence and reconciliation are separate ports. */
export function buildUsageRecord(input: BuildUsageRecordInput): UsageRecord {
  if (
    !validAuditAttribution(input) ||
    !nonempty(input.requestId) ||
    !nonempty(input.attemptId) ||
    !nonempty(input.modelAlias) ||
    (input.routeKind !== 'delegated' && input.routeKind !== 'managed') ||
    !nonempty(input.upstreamModelId) ||
    !nonempty(input.selectedCandidateId) ||
    (input.actualInferenceProviderId !== undefined && !nonempty(input.actualInferenceProviderId)) ||
    !nonnegativeInteger(input.occurredAt) ||
    !nonnegativeInteger(input.latencyMs) ||
    (input.outcome !== 'succeeded' && input.outcome !== 'failed') ||
    typeof input.possiblyBilled !== 'boolean' ||
    typeof input.possibleDuplicate !== 'boolean'
  ) {
    throw new InvalidUsageRecordInput();
  }

  return {
    requestId: input.requestId,
    attemptId: input.attemptId,
    principalId: input.principalId,
    credentialId: input.credentialId,
    policyVersions: input.policyVersions.map(({ id, version }) => ({ id, version })),
    modelAlias: input.modelAlias,
    routeKind: input.routeKind,
    upstreamModelId: input.upstreamModelId,
    selectedCandidateId: input.selectedCandidateId,
    actualInferenceProviderId: input.actualInferenceProviderId ?? null,
    occurredAt: input.occurredAt,
    latencyMs: input.latencyMs,
    outcome: input.outcome,
    possiblyBilled: input.possiblyBilled,
    possibleDuplicate: input.possibleDuplicate,
    usage: tokens(input.providerUsage),
    estimatedCost: estimate(input.estimatedCost),
    upstreamBilledCost: billed(input.upstreamBilledCost),
  };
}
