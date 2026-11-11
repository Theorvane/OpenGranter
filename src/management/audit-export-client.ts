import { serializeAuditCsv } from '../audit/csv.ts';
import { type AuditFilters, type AuditResult, createAuditHistoryClient } from './audit-client.ts';
import type { CatalogRequest } from './catalog-client.ts';

export type AuditPageExportResult =
  | {
      readonly state: 'ready';
      readonly csv: string;
      readonly contentType: 'text/csv; charset=utf-8';
      readonly hasMore: boolean;
      readonly nextCursor: string | null;
    }
  | Exclude<AuditResult, { readonly state: 'ready' }>;

/** Projects one fully validated authorized JSON page, not a server CSV request.
 * Host must invalidate on logout/expiry/identity change and remove old downloads.
 * No credentials, retained content, cached CSV or automatic pagination.
 */
export function createAuditPageExportClient(request: CatalogRequest) {
  const client = createAuditHistoryClient(request);
  let revision = 0;
  function invalidate() {
    revision++;
    client.invalidate();
  }
  return {
    invalidate,
    async read(filters: AuditFilters): Promise<AuditPageExportResult> {
      const current = ++revision;
      // Own scalar inputs before the first await, including the exact decimal cursor.
      let query: AuditFilters;
      try {
        const { principalId, model, fromMs, toMs, limit, cursor } = filters;
        query = {
          principalId,
          ...(model === undefined ? {} : { model }),
          ...(fromMs === undefined ? {} : { fromMs }),
          ...(toMs === undefined ? {} : { toMs }),
          ...(limit === undefined ? {} : { limit }),
          ...(cursor === undefined ? {} : { cursor }),
        };
      } catch {
        client.invalidate();
        return { state: 'invalid_query' };
      }
      const result = await client.read(query);
      if (current !== revision) return { state: 'cancelled' };
      if (result.state !== 'ready') return result;
      try {
        const csv = serializeAuditCsv(
          { events: result.data, nextCursor: result.nextCursor },
          query.principalId,
          {
            limit: query.limit ?? 50,
            cursor: query.cursor ?? null,
            ...(query.model === undefined ? {} : { modelAlias: query.model }),
            ...(query.fromMs === undefined ? {} : { fromMs: query.fromMs }),
            ...(query.toMs === undefined ? {} : { toMs: query.toMs }),
          },
        );
        return {
          state: 'ready',
          csv,
          contentType: 'text/csv; charset=utf-8',
          hasMore: result.hasMore,
          nextCursor: result.nextCursor,
        };
      } catch {
        return { state: 'unavailable' };
      }
    },
  };
}
