import type { UsageRecord } from './record-usage.ts';

export interface UsageSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class UsageLedgerConflict extends Error {
  constructor() {
    super('Usage attempt conflicts with an existing record');
    this.name = 'UsageLedgerConflict';
  }
}

export class UsageLedgerUnavailable extends Error {
  constructor() {
    super('Usage ledger unavailable');
    this.name = 'UsageLedgerUnavailable';
  }
}

/** Copy only the normalized usage contract; never serialize extra caller fields. */
function storedRecord(record: UsageRecord): UsageRecord {
  return {
    requestId: record.requestId,
    attemptId: record.attemptId,
    principalId: record.principalId,
    credentialId: record.credentialId,
    policyVersions: record.policyVersions.map(({ id, version }) => ({ id, version })),
    modelAlias: record.modelAlias,
    routeKind: record.routeKind,
    upstreamModelId: record.upstreamModelId,
    selectedCandidateId: record.selectedCandidateId,
    actualInferenceProviderId: record.actualInferenceProviderId,
    occurredAt: record.occurredAt,
    latencyMs: record.latencyMs,
    outcome: record.outcome,
    possiblyBilled: record.possiblyBilled,
    possibleDuplicate: record.possibleDuplicate,
    usage: {
      status: record.usage.status,
      promptTokens: record.usage.promptTokens,
      completionTokens: record.usage.completionTokens,
      totalTokens: record.usage.totalTokens,
    },
    estimatedCost: record.estimatedCost
      ? {
          amountDecimal: record.estimatedCost.amountDecimal,
          currency: record.estimatedCost.currency,
          priceVersion: record.estimatedCost.priceVersion,
        }
      : null,
    upstreamBilledCost: record.upstreamBilledCost
      ? {
          amountDecimal: record.upstreamBilledCost.amountDecimal,
          currency: record.upstreamBilledCost.currency,
          source: record.upstreamBilledCost.source,
        }
      : null,
  };
}

function row(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Atomic insert plus exact-replay check; the caller supplies a migrated PostgreSQL client. */
export function createPostgresUsageLedger(
  client: UsageSqlClient,
): (record: UsageRecord) => Promise<void> {
  return async (record) => {
    try {
      const payload = JSON.stringify(storedRecord(record));
      const inserted = await client.query(
        `INSERT INTO usage_records (attempt_id, request_id, principal_id, occurred_at_ms, record)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (attempt_id) DO NOTHING
         RETURNING attempt_id`,
        [record.attemptId, record.requestId, record.principalId, record.occurredAt, payload],
      );
      if (inserted.rows.length === 1) return;
      const existing = await client.query(
        'SELECT record = $2::jsonb AS matches FROM usage_records WHERE attempt_id = $1',
        [record.attemptId, payload],
      );
      if (row(existing.rows[0])?.matches === true) return;
      if (existing.rows.length === 1) throw new UsageLedgerConflict();
      throw new UsageLedgerUnavailable();
    } catch (error) {
      if (error instanceof UsageLedgerConflict || error instanceof UsageLedgerUnavailable)
        throw error;
      throw new UsageLedgerUnavailable();
    }
  };
}
