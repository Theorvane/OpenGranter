import { serializeAuditCsv } from '../audit/csv.ts';
import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-http.ts';
import {
  type AuditHistoryPage,
  createPostgresAuditHistoryReader,
} from '../audit/postgres-audit-history.ts';
import type { GatewayAuditSqlClient } from '../audit/postgres-gateway-audit.ts';
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

type Failure = 'unauthenticated' | 'forbidden' | 'invalid_query' | 'unavailable';
type ReadResult =
  | { readonly state: Failure }
  | ({ readonly state: 'ready' } & (
      | { readonly format: 'json'; readonly page: AuditHistoryPage }
      | { readonly format: 'csv'; readonly csv: string; readonly nextCursor: string | null }
    ));
export type SsoAuditHistoryResult = ReadResult | { readonly state: 'audit_unavailable' };

/** SSO reader attribution, never a proxy credential or gateway event. */
export interface SsoAuditHistoryAccessEvent {
  readonly requestId: string;
  readonly principalId: string | null;
  readonly policyVersions: readonly PolicyVersion[] | null;
  readonly targetPrincipalId: string | null;
  readonly outcome: Failure | 'ready';
  readonly count: number;
}

/** Gateway metadata history only. The caller MUST provide an approved durable SSO
 * access-audit writer before mounting. No management-event history, content audit,
 * cookie/session, DDL or listener activation. Fresh IAM is not atomic revocation.
 */
export function createPostgresSsoAuditHistory(
  ports: SsoAccessTokenConfiguration & {
    readonly client: GatewayAuditSqlClient;
    readonly writeAudit: (event: SsoAuditHistoryAccessEvent) => Promise<void>;
  },
) {
  const authenticate = createPostgresRfc9068SsoPolicyAuthenticator(ports);
  if (typeof ports.writeAudit !== 'function') throw new InvalidSsoAccessTokenConfiguration();
  const writeAudit = ports.writeAudit;
  const listAudit = createPostgresAuditHistoryReader(ports.client);
  return {
    async read(
      accessToken: string,
      requestId: string,
      query: string,
    ): Promise<SsoAuditHistoryResult> {
      let context: SsoPolicyContext | undefined;
      let targetPrincipalId: string | null = null;
      let count = 0;
      let result: ReadResult;
      try {
        context = await authenticate(accessToken);
        let parsed: ReturnType<typeof parseAuditHistoryQuery>;
        try {
          if (typeof query !== 'string') throw Error('invalid query');
          const url = new URL('https://management.invalid/');
          url.search = query;
          parsed = parseAuditHistoryQuery(url);
        } catch {
          return await audited({ state: 'invalid_query' });
        }
        targetPrincipalId = parsed.requestedPrincipalId ?? context.id;
        const decision = evaluate({
          principalActive: context.active,
          action: 'audit:Read',
          resource: `principal:${targetPrincipalId}`,
          statements: context.statements,
        });
        if (decision.effect !== 'Allow') result = { state: 'forbidden' };
        else {
          const readQuery = {
            principalId: targetPrincipalId,
            limit: parsed.limit,
            cursor: parsed.cursor,
            ...(parsed.modelAlias === undefined ? {} : { modelAlias: parsed.modelAlias }),
            ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
            ...(parsed.fromMs === undefined ? {} : { fromMs: parsed.fromMs }),
            ...(parsed.toMs === undefined ? {} : { toMs: parsed.toMs }),
          };
          const page = projectAuditHistoryPage(
            await listAudit(readQuery),
            targetPrincipalId,
            parsed.limit,
            parsed.cursor,
            readQuery,
          );
          result =
            parsed.format === 'csv'
              ? {
                  state: 'ready',
                  format: 'csv',
                  csv: serializeAuditCsv(page, targetPrincipalId, readQuery),
                  nextCursor: page.nextCursor,
                }
              : { state: 'ready', format: 'json', page };
          count = page.events.length;
        }
      } catch (error) {
        result = {
          state: error instanceof SsoManagementUnauthenticated ? 'unauthenticated' : 'unavailable',
        };
      }
      return await audited(result);
      async function audited(value: ReadResult): Promise<SsoAuditHistoryResult> {
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
