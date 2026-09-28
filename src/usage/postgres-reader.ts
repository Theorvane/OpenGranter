import {
  matchesUsageHistoryFilters,
  parseStoredUsageRecord,
  type UsageHistoryPage,
  type UsageHistoryQuery,
  validUsageCursor,
  validUsageHistoryFilters,
  validUsageHistoryOrder,
} from './history.ts';
import { UsageLedgerUnavailable, type UsageSqlClient } from './postgres-ledger.ts';

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read one principal's attempts in stable descending keyset order. */
export function createPostgresUsageReader(
  client: UsageSqlClient,
): (query: UsageHistoryQuery) => Promise<UsageHistoryPage> {
  return async (query) => {
    if (
      !query.principalId ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      !validUsageHistoryFilters(query) ||
      (query.cursor !== null && !validUsageCursor(query.cursor))
    ) {
      throw new UsageLedgerUnavailable();
    }
    try {
      const result = await client.query(
        `SELECT attempt_id, principal_id, occurred_at_ms::text AS occurred_at_ms, record
         FROM usage_records
         WHERE principal_id = $1
           AND ($2::bigint IS NULL OR (occurred_at_ms, attempt_id COLLATE "C") < ($2::bigint, $3::text COLLATE "C"))
           AND ($5::text IS NULL OR record->>'modelAlias' = $5::text)
           AND ($6::bigint IS NULL OR occurred_at_ms >= $6::bigint)
           AND ($7::bigint IS NULL OR occurred_at_ms < $7::bigint)
         ORDER BY occurred_at_ms DESC, attempt_id COLLATE "C" DESC
         LIMIT $4`,
        [
          query.principalId,
          query.cursor?.occurredAt ?? null,
          query.cursor?.attemptId ?? null,
          query.limit + 1,
          query.modelAlias ?? null,
          query.fromMs ?? null,
          query.toMs ?? null,
        ],
      );
      if (result.rows.length > query.limit + 1) throw new UsageLedgerUnavailable();
      const records = result.rows.map((value) => {
        const row = object(value);
        const stored = parseStoredUsageRecord(row?.record);
        if (
          !matchesUsageHistoryFilters(stored, query) ||
          stored.principalId !== query.principalId ||
          row?.principal_id !== query.principalId ||
          row.attempt_id !== stored.attemptId ||
          row.occurred_at_ms !== String(stored.occurredAt)
        ) {
          throw new UsageLedgerUnavailable();
        }
        return stored;
      });
      if (!validUsageHistoryOrder(records, query.cursor)) throw new UsageLedgerUnavailable();
      return { records: records.slice(0, query.limit), hasMore: records.length > query.limit };
    } catch {
      throw new UsageLedgerUnavailable();
    }
  };
}
