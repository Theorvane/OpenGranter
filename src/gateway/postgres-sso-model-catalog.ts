import { SsoManagementUnauthenticated } from '../identity/postgres-sso-human-authentication.ts';
import {
  createPostgresRfc9068SsoPolicyAuthenticator,
  type SsoPolicyContext,
} from '../identity/postgres-sso-policy-context.ts';
import {
  InvalidSsoAccessTokenConfiguration,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import type { PolicyVersion } from '../policy/evaluate-attachments.ts';
import { authorizeCandidates } from '../routing/authorize-candidates.ts';
import {
  createPostgresModelCatalogReader,
  type ModelCatalogSqlClient,
} from './postgres-model-catalog.ts';

export interface SsoCatalogModel {
  readonly id: string;
  readonly object: 'model';
  readonly created: number;
  readonly owned_by: 'opengranter';
  /** Explicit administrator-published information, never routing authority. */
  readonly name?: string;
  readonly description?: string;
  readonly context_length?: number | null;
}
export type SsoCatalogResult<T> =
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'missing' | 'unauthenticated' | 'unavailable' | 'audit_unavailable' };

/** Server-only metadata contract, not a gateway proxy-credential audit event.
 * The integration must durably append before returning data to an HTTP caller.
 */
export type SsoCatalogAuditEvent = {
  readonly requestId: string;
  readonly operation: 'list' | 'detail';
  readonly count: number;
} & (
  | {
      readonly outcome: 'unauthenticated' | 'unavailable';
      readonly principalId: null;
      readonly policyVersions: null;
    }
  | {
      readonly outcome: 'ready' | 'missing' | 'unavailable';
      readonly principalId: string;
      readonly policyVersions: readonly PolicyVersion[];
    }
);

/** Internal SSO user discovery, NOT catalog administration or a session boundary.
 * Every call verifies the JWT/current binding and reads fresh IAM and catalog.
 * Separate reads do not promise atomic revocation. No caching, credential issue,
 * SQL writes, secret lookup, provider invocation or HTTP activation occurs here.
 */
export function createPostgresSsoModelCatalog(
  ports: SsoAccessTokenConfiguration & {
    readonly client: ModelCatalogSqlClient;
    readonly writeAudit: (event: SsoCatalogAuditEvent) => Promise<void>;
  },
) {
  const authenticate = createPostgresRfc9068SsoPolicyAuthenticator(ports);
  if (typeof ports.writeAudit !== 'function') throw new InvalidSsoAccessTokenConfiguration();
  const writeAudit = ports.writeAudit;
  const catalog = createPostgresModelCatalogReader(ports.client);

  async function read(
    accessToken: string,
    requestId: string,
    operation: 'list' | 'detail',
    alias?: string,
  ): Promise<SsoCatalogResult<readonly SsoCatalogModel[]>> {
    let principal: SsoPolicyContext | undefined;
    let result: SsoCatalogResult<readonly SsoCatalogModel[]>;
    try {
      const context = await authenticate(accessToken);
      principal = context;
      const publication =
        operation === 'detail' ? await catalog.findPublishedModel(alias ?? '') : undefined;
      const models =
        operation === 'list'
          ? await catalog.listPublishedModels()
          : publication
            ? [publication]
            : [];
      const data = Object.freeze(
        models
          .filter(
            (model) =>
              (operation === 'list' || model.alias === alias) &&
              model.enabled &&
              model.routes.some(
                (route) =>
                  authorizeCandidates({
                    principalActive: context.active,
                    modelAlias: model.alias,
                    routeKind: route.kind,
                    candidates: route.candidates,
                    statements: context.statements,
                  }).candidates.length > 0,
              ),
          )
          .map(
            (model): SsoCatalogModel =>
              Object.freeze({
                id: model.alias,
                object: 'model',
                created: model.created,
                owned_by: 'opengranter',
                ...(model.openRouterMetadata === undefined
                  ? {}
                  : {
                      name: model.openRouterMetadata.name,
                      ...(model.openRouterMetadata.description === undefined
                        ? {}
                        : { description: model.openRouterMetadata.description }),
                      context_length: model.openRouterMetadata.context_length,
                    }),
              }),
          ),
      );
      result =
        operation === 'detail' && data.length === 0
          ? { state: 'missing' }
          : { state: 'ready', data };
    } catch (error) {
      result = {
        state: error instanceof SsoManagementUnauthenticated ? 'unauthenticated' : 'unavailable',
      };
    }
    const common = {
      requestId,
      operation,
      count: result.state === 'ready' ? result.data.length : 0,
    };
    const event: SsoCatalogAuditEvent = principal
      ? {
          ...common,
          outcome:
            result.state === 'ready' || result.state === 'missing' ? result.state : 'unavailable',
          principalId: principal.id,
          policyVersions: Object.freeze(
            principal.policyVersions.map(({ id, version }) => Object.freeze({ id, version })),
          ),
        }
      : {
          ...common,
          outcome: result.state === 'unauthenticated' ? 'unauthenticated' : 'unavailable',
          principalId: null,
          policyVersions: null,
        };
    try {
      await writeAudit(Object.freeze(event));
    } catch {
      return { state: 'audit_unavailable' };
    }
    return result;
  }
  return {
    list: (accessToken: string, requestId: string) => read(accessToken, requestId, 'list'),
    async detail(
      accessToken: string,
      requestId: string,
      alias: string,
    ): Promise<SsoCatalogResult<SsoCatalogModel>> {
      const result = await read(accessToken, requestId, 'detail', alias);
      if (result.state !== 'ready') return result;
      const model = result.data[0];
      return model ? { state: 'ready', data: model } : { state: 'missing' };
    },
  };
}
