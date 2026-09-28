import { validAuditAttribution } from '../audit/attribution.ts';
import { buildUsageRecord, InvalidUsageRecordInput, type UsageRecord } from './record-usage.ts';

export interface UsageCursor {
  readonly occurredAt: number;
  readonly attemptId: string;
}

export interface UsageHistoryFilters {
  readonly modelAlias?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
}

export interface UsageHistoryQuery extends UsageHistoryFilters {
  readonly principalId: string;
  readonly limit: number;
  readonly cursor: UsageCursor | null;
}

export interface UsageHistoryPage {
  readonly records: readonly UsageRecord[];
  readonly hasMore: boolean;
}

export class InvalidUsageQuery extends Error {
  constructor() {
    super('Invalid usage query');
    this.name = 'InvalidUsageQuery';
  }
}

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

export function validUsageHistoryFilters(filters: UsageHistoryFilters): boolean {
  return (
    (filters.modelAlias === undefined ||
      (nonempty(filters.modelAlias) &&
        filters.modelAlias.length <= 256 &&
        !/[\p{Cc}]/u.test(filters.modelAlias))) &&
    (filters.fromMs === undefined || count(filters.fromMs)) &&
    (filters.toMs === undefined || count(filters.toMs)) &&
    (filters.fromMs === undefined || filters.toMs === undefined || filters.fromMs < filters.toMs)
  );
}

export function matchesUsageHistoryFilters(
  record: UsageRecord,
  filters: UsageHistoryFilters,
): boolean {
  return (
    (filters.modelAlias === undefined || record.modelAlias === filters.modelAlias) &&
    (filters.fromMs === undefined || record.occurredAt >= filters.fromMs) &&
    (filters.toMs === undefined || record.occurredAt < filters.toMs)
  );
}

function queryTime(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || !count(Number(value))) throw new InvalidUsageQuery();
  return Number(value);
}

export function validUsageCursor(value: unknown): value is UsageCursor {
  const cursor = object(value);
  return (
    cursor !== undefined &&
    count(cursor.occurredAt) &&
    nonempty(cursor.attemptId) &&
    cursor.attemptId.length <= 512
  );
}

/** Validate the entire sequence, including hidden lookahead, against the shared UTF-8 key order. */
export function validUsageHistoryOrder(
  records: readonly UsageRecord[],
  cursor: UsageCursor | null,
): boolean {
  if (cursor !== null && !validUsageCursor(cursor)) return false;
  let previous = cursor;
  const seen = new Set<string>(cursor === null ? [] : [cursor.attemptId]);
  for (const record of records) {
    if (seen.has(record.attemptId)) return false;
    seen.add(record.attemptId);
    if (
      previous !== null &&
      (record.occurredAt > previous.occurredAt ||
        (record.occurredAt === previous.occurredAt &&
          Buffer.compare(
            Buffer.from(record.attemptId, 'utf8'),
            Buffer.from(previous.attemptId, 'utf8'),
          ) >= 0))
    )
      return false;
    previous = record;
  }
  return true;
}

export function parseUsageCursor(value: string): UsageCursor {
  if (value.length === 0 || value.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new InvalidUsageQuery();
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const cursor: unknown =
      Array.isArray(parsed) && parsed.length === 2
        ? { occurredAt: parsed[0], attemptId: parsed[1] }
        : null;
    if (!validUsageCursor(cursor)) throw new InvalidUsageQuery();
    return cursor;
  } catch {
    throw new InvalidUsageQuery();
  }
}

export function encodeUsageCursor(cursor: UsageCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.attemptId])).toString('base64url');
}

export function parseUsageHistoryQuery(url: URL): UsageHistoryFilters & {
  readonly requestedPrincipalId: string | null;
  readonly format: 'json' | 'csv';
  readonly limit: number;
  readonly cursor: UsageCursor | null;
} {
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (
      !['principal_id', 'limit', 'cursor', 'model', 'from_ms', 'to_ms', 'format'].includes(key) ||
      params.getAll(key).length !== 1
    ) {
      throw new InvalidUsageQuery();
    }
  }
  const requestedPrincipalId = params.get('principal_id');
  if (
    requestedPrincipalId !== null &&
    (!nonempty(requestedPrincipalId) ||
      requestedPrincipalId.length > 256 ||
      [...requestedPrincipalId].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }))
  ) {
    throw new InvalidUsageQuery();
  }
  const format = params.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') throw new InvalidUsageQuery();
  const rawLimit = params.get('limit');
  if (rawLimit !== null && !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit)) {
    throw new InvalidUsageQuery();
  }
  const rawCursor = params.get('cursor');
  const modelAlias = params.get('model');
  const fromMs = queryTime(params.get('from_ms'));
  const toMs = queryTime(params.get('to_ms'));
  const filters = {
    ...(modelAlias === null ? {} : { modelAlias }),
    ...(fromMs === undefined ? {} : { fromMs }),
    ...(toMs === undefined ? {} : { toMs }),
  };
  if (!validUsageHistoryFilters(filters)) throw new InvalidUsageQuery();
  return {
    requestedPrincipalId,
    format,
    ...filters,
    limit: rawLimit === null ? 50 : Number(rawLimit),
    cursor: rawCursor === null ? null : parseUsageCursor(rawCursor),
  };
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
