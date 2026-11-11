import { SsoManagementUnauthenticated } from '../identity/postgres-sso-human-authentication.ts';
import {
  createPostgresRfc9068SsoPolicyAuthenticator,
  type SsoPolicyContext,
} from '../identity/postgres-sso-policy-context.ts';
import {
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import { evaluate } from '../policy/evaluate.ts';
import type { PolicyVersion } from '../policy/evaluate-attachments.ts';
import { serializeUsageCsv } from '../usage/csv.ts';
import { encodeUsageCursor, parseUsageCursor, parseUsageHistoryQuery } from '../usage/history.ts';
import type { UsageSqlClient } from '../usage/postgres-ledger.ts';
import { createPostgresUsageReader } from '../usage/postgres-reader.ts';
import type { UsageRecord } from '../usage/record-usage.ts';

type Failure = 'unauthenticated' | 'forbidden' | 'invalid_query' | 'unavailable';
type ReadResult =
  | { readonly state: Failure }
  | ({ readonly state: 'ready'; readonly hasMore: boolean; readonly nextCursor: string | null } & (
      | { readonly format: 'json'; readonly data: readonly UsageRecord[] }
      | { readonly format: 'csv'; readonly csv: string }
    ));

export type SsoUsageResult = ReadResult | { readonly state: 'audit_unavailable' };

/** SSO metadata only. Never a proxy-credential event or a durable-store claim. */
export interface SsoUsageAuditEvent {
  readonly requestId: string;
  readonly principalId: string | null;
  readonly policyVersions: readonly PolicyVersion[] | null;
  readonly targetPrincipalId: string | null;
  readonly mode: 'self' | 'all' | null;
  readonly outcome: Failure | 'ready';
  readonly count: number;
}

/** Internal database-backed read, not a session, HTTP route or deployment.
 * The integration must durably append SSO metadata before exposing any result.
 * Fresh binding/IAM reads are not an atomic revocation guarantee.
 */
export function createPostgresSsoUsageHistory(
  ports: SsoAccessTokenConfiguration & {
    readonly client: UsageSqlClient;
    readonly writeAudit: (event: SsoUsageAuditEvent) => Promise<void>;
  },
) {
  const authenticate = createPostgresRfc9068SsoPolicyAuthenticator(ports);
  if (typeof ports.writeAudit !== 'function') throw new InvalidSsoAccessTokenConfiguration();
  const writeAudit = ports.writeAudit;
  const listUsage = createPostgresUsageReader(ports.client);
  return {
    async read(accessToken: string, requestId: string, query: string): Promise<SsoUsageResult> {
      let context: SsoPolicyContext | undefined;
      let targetPrincipalId: string | null = null;
      let mode: 'self' | 'all' | null = null;
      let count = 0;
      let result: ReadResult;
      try {
        context = await authenticate(accessToken);
        let parsed: ReturnType<typeof parseUsageHistoryQuery>;
        try {
          if (typeof query !== 'string') throw new Error('invalid query');
          const url = new URL('https://management.invalid/');
          url.search = query;
          parsed = parseUsageHistoryQuery(url);
        } catch {
          // Kept local to distinguish malformed query from SQL/authentication failures.
          result = { state: 'invalid_query' };
          return await audited(result);
        }
        targetPrincipalId = parsed.requestedPrincipalId ?? context.id;
        mode = parsed.requestedPrincipalId === null ? 'self' : 'all';
        const decision = evaluate({
          principalActive: context.active,
          action: mode === 'self' ? 'usage:ReadSelf' : 'usage:ReadAll',
          resource: `principal:${targetPrincipalId}`,
          statements: context.statements,
        });
        if (decision.effect !== 'Allow') {
          result = { state: 'forbidden' };
        } else {
          const page = await listUsage({
            principalId: targetPrincipalId,
            limit: parsed.limit,
            cursor: parsed.cursor,
            ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
            ...(parsed.modelAlias === undefined ? {} : { modelAlias: parsed.modelAlias }),
            ...(parsed.fromMs === undefined ? {} : { fromMs: parsed.fromMs }),
            ...(parsed.toMs === undefined ? {} : { toMs: parsed.toMs }),
          });
          const last = page.records.at(-1);
          if (page.hasMore && (!last || last.attemptId.length > 512)) {
            throw new Error('invalid usage cursor');
          }
          const nextCursor =
            page.hasMore && last
              ? encodeUsageCursor({ occurredAt: last.occurredAt, attemptId: last.attemptId })
              : null;
          // Character bounds alone do not bound the UTF-8/base64url continuation.
          if (nextCursor !== null) parseUsageCursor(nextCursor);
          const common = { state: 'ready' as const, hasMore: page.hasMore, nextCursor };
          result =
            parsed.format === 'csv'
              ? { ...common, format: 'csv', csv: serializeUsageCsv(page.records) }
              : { ...common, format: 'json', data: page.records };
          count = page.records.length;
        }
      } catch (error) {
        result = {
          state: error instanceof SsoManagementUnauthenticated ? 'unauthenticated' : 'unavailable',
        };
      }
      return await audited(result);

      async function audited(value: ReadResult): Promise<SsoUsageResult> {
        try {
          await writeAudit(
            Object.freeze({
              requestId,
              principalId: context?.id ?? null,
              policyVersions: context
                ? Object.freeze(
                    context.policyVersions.map(({ id, version }) => Object.freeze({ id, version })),
                  )
                : null,
              targetPrincipalId,
              mode,
              outcome: value.state,
              count: value.state === 'ready' ? count : 0,
            }),
          );
          return value;
        } catch {
          return { state: 'audit_unavailable' };
        }
      }
    },
  };
}
