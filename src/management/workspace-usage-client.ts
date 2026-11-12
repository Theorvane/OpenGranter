import type { UsageRecord } from '../usage/record-usage.ts';
import type { CatalogRequest } from './catalog-client.ts';
import { createSsoUsageClient, type UsageFilters } from './usage-client.ts';
import { createSsoUsageExportClient } from './usage-export-client.ts';

export type { UsageFilters } from './usage-client.ts';
export interface UsagePage {
  readonly records: readonly UsageRecord[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}
export interface UsageCsvPage {
  readonly csv: string;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}
export type UsageClientResult<T> =
  | { readonly state: 'ready'; readonly data: T }
  | {
      readonly state: 'invalid_query' | 'unauthenticated' | 'denied' | 'unavailable' | 'cancelled';
    };

/** Transport-only compatibility for the product workspace. Canonical clients own
 * decoding, bounded reads, deadlines and scope validation. No credential source,
 * session, store or new authority is introduced here.
 */
export function createManagementUsageClient(request: CatalogRequest) {
  const json = createSsoUsageClient(request);
  const csv = createSsoUsageExportClient(request);
  function invalidate() {
    json.invalidate();
    csv.invalidate();
  }
  return {
    invalidate,
    async list(filters: UsageFilters = {}): Promise<UsageClientResult<UsagePage>> {
      invalidate();
      const result = await json.read(filters);
      return result.state === 'ready'
        ? {
            state: 'ready',
            data: { records: result.data, hasMore: result.hasMore, nextCursor: result.nextCursor },
          }
        : result;
    },
    async csv(filters: UsageFilters = {}): Promise<UsageClientResult<UsageCsvPage>> {
      invalidate();
      const result = await csv.read(filters);
      return result.state === 'ready'
        ? {
            state: 'ready',
            data: { csv: result.csv, hasMore: result.hasMore, nextCursor: result.nextCursor },
          }
        : result;
    },
  };
}
