import type { Server } from 'node:http';
import { type ClientErrorCode, createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import type {
  createPostgresSsoModelCatalog,
  SsoCatalogModel,
} from './postgres-sso-model-catalog.ts';

export interface SsoModelCatalogHttpPorts {
  readonly newRequestId: () => string;
  /** Trusted fresh-authentication service with mandatory awaited durable SSO audit. */
  readonly catalog: ReturnType<typeof createPostgresSsoModelCatalog>;
}
const base = '/management/v1/models';
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
function failure(status: number, code: ClientErrorCode, requestId?: string): Response {
  const response = noStore(createClientErrorResponse(status, code, requestId));
  if (status === 401) response.headers.set('www-authenticate', 'Bearer');
  return response;
}
function validAlias(alias: string): boolean {
  return (
    alias.length > 0 &&
    alias.length <= 512 &&
    !/[\s%\\?#]/u.test(alias) &&
    !Array.from(alias).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      );
    }) &&
    alias.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
function basePricing(value: unknown): NonNullable<SsoCatalogModel['pricing']> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
  const row = value as Record<string, unknown>;
  const price = (field: string): string => {
    const result = row[field];
    if (
      !Object.hasOwn(row, field) ||
      typeof result !== 'string' ||
      result.length > 128 ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(result) ||
      !Number.isFinite(Number(result))
    )
      throw new Error();
    return result;
  };
  return { prompt: price('prompt'), completion: price('completion') };
}
function project(model: SsoCatalogModel): SsoCatalogModel {
  if (
    !model ||
    typeof model.id !== 'string' ||
    !validAlias(model.id) ||
    model.object !== 'model' ||
    !Number.isSafeInteger(model.created) ||
    model.created < 0 ||
    model.owned_by !== 'opengranter' ||
    (Object.hasOwn(model, 'name') &&
      (typeof model.name !== 'string' || !model.name.trim() || model.name.length > 256)) ||
    (Object.hasOwn(model, 'description') &&
      (typeof model.description !== 'string' || model.description.length > 8192)) ||
    (Object.hasOwn(model, 'context_length') &&
      model.context_length !== null &&
      (typeof model.context_length !== 'number' ||
        !Number.isSafeInteger(model.context_length) ||
        model.context_length < 0))
  )
    throw new Error();
  return {
    id: model.id,
    object: 'model',
    created: model.created,
    owned_by: 'opengranter',
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.description === undefined ? {} : { description: model.description }),
    ...(model.context_length === undefined ? {} : { context_length: model.context_length }),
    ...(Object.hasOwn(model, 'pricing') ? { pricing: basePricing(model.pricing) } : {}),
  };
}

/** Explicit server-facing Bearer API, not a cookie/session or catalog-write API.
 * Does not bind a socket or mount into inference/browser runtimes automatically.
 */
export function createSsoModelCatalogHandler(
  ports: SsoModelCatalogHttpPorts,
): (request: Request) => Promise<Response> {
  const { newRequestId } = ports;
  const { list, detail } = ports.catalog;
  return async (request) => {
    let requestId: string | undefined;
    try {
      const url = new URL(request.url);
      const isList = url.pathname === base;
      const detailPath = url.pathname.startsWith(`${base}/`)
        ? url.pathname.slice(base.length + 1)
        : undefined;
      if (request.method !== 'GET' || (!isList && detailPath === undefined))
        return failure(404, 'not_found');
      const generatedId = newRequestId();
      if (
        typeof generatedId !== 'string' ||
        generatedId.length > 256 ||
        !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(generatedId)
      )
        return failure(503, 'internal_error');
      requestId = generatedId;
      // Node drops GET bodies before Fetch adaptation; reject original framing too.
      const length = request.headers.get('content-length');
      if (
        request.signal.aborted ||
        url.search ||
        request.body !== null ||
        request.headers.has('transfer-encoding') ||
        (length !== null && length !== '0')
      )
        return failure(400, 'invalid_request', requestId);
      let alias: string | undefined;
      if (!isList) {
        try {
          if (!detailPath || detailPath.includes('/'))
            return failure(400, 'invalid_request', requestId);
          alias = decodeURIComponent(detailPath);
          if (!validAlias(alias)) return failure(400, 'invalid_request', requestId);
        } catch {
          return failure(400, 'invalid_request', requestId);
        }
      }
      const token = /^Bearer ([^\s,]+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      // An absent/malformed Bearer still reaches the service for mandatory denial audit.
      // Empty input must be rejected by its registered-key authenticator.
      const result =
        alias === undefined
          ? await list(token ?? '', requestId)
          : await detail(token ?? '', requestId, alias);
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      switch (result.state) {
        case 'unauthenticated':
          return failure(401, 'unauthorized', requestId);
        case 'unavailable':
          return failure(503, 'catalog_unavailable', requestId);
        case 'audit_unavailable':
          return failure(503, 'audit_unavailable', requestId);
        case 'missing':
          if (!token || isList) return failure(503, 'internal_error', requestId);
          return failure(404, 'unknown_model', requestId);
        case 'ready': {
          if (!token) return failure(503, 'internal_error', requestId);
          let body: unknown;
          if (isList) {
            if (!Array.isArray(result.data)) return failure(503, 'internal_error', requestId);
            body = { object: 'list', data: result.data.map(project) };
          } else {
            if (Array.isArray(result.data)) return failure(503, 'internal_error', requestId);
            const model = project(result.data as SsoCatalogModel);
            if (model.id !== alias) return failure(503, 'internal_error', requestId);
            body = model;
          }
          return noStore(Response.json(body, { headers: { 'x-request-id': requestId } }));
        }
        default:
          return failure(503, 'internal_error', requestId);
      }
    } catch {
      return failure(503, 'internal_error', requestId);
    }
  };
}

/** Caller owns listening, ingress, TLS, durable audit, database and session lifetime. */
export function createSsoModelCatalogServer(ports: SsoModelCatalogHttpPorts): Server {
  return createNodeRequestServer(createSsoModelCatalogHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
