import type { Server } from 'node:http';
import { createNodeRequestServer } from '../gateway/node-request-server.ts';
import {
  createRfc9068SsoAccessTokenVerifier,
  type SsoAccessTokenConfiguration,
} from '../identity/rfc9068-sso-access-tokens.ts';
import {
  type ConfigurationOperation,
  createOwnedConfigurationService,
} from './owned-configuration-service.ts';

type Service = ReturnType<typeof createOwnedConfigurationService>;
const operations = new Set(['create', 'read', 'publish', 'import']);
function response(status: number, body: unknown, requestId?: string): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (requestId !== undefined) headers['x-request-id'] = requestId;
  if (status === 401) headers['www-authenticate'] = 'Bearer';
  return Response.json(body, { status, headers });
}

/** Bound bytes, lifetime and decoding. Invoked only after authentication and explicit IAM. */
async function readInput(request: Request): Promise<unknown> {
  const url = new URL(request.url);
  const encoding = request.headers.get('content-encoding');
  if (
    url.search ||
    request.signal.aborted ||
    (encoding !== null && encoding.trim().toLowerCase() !== 'identity') ||
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  let stopped = false;
  let complete = false;
  const cancel = () => {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Best effort cleanup. */
    }
  };
  let stop!: () => void;
  const stopping = new Promise<undefined>((resolve) => {
    stop = () => {
      stopped = true;
      resolve(undefined);
      cancel();
    };
  });
  const started = performance.now();
  const timer = setTimeout(stop, 15000);
  request.signal.addEventListener('abort', stop, { once: true });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let text = '';
    while (!stopped && !request.signal.aborted) {
      const next = await Promise.race([reader.read(), stopping]);
      const now = performance.now();
      if (
        !next ||
        stopped ||
        request.signal.aborted ||
        !Number.isFinite(now) ||
        now < started ||
        now - started >= 15000
      )
        return undefined;
      if (next.done) {
        complete = true;
        break;
      }
      size += next.value.byteLength;
      if (size > 262144) return undefined;
      text += decoder.decode(next.value, { stream: true });
    }
    if (!complete || request.signal.aborted) return undefined;
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', stop);
    if (!complete) cancel();
    try {
      reader.releaseLock();
    } catch {
      /* A pending producer cannot block a fixed error. */
    }
  }
}

export function createOwnedConfigurationHandler(ports: {
  readonly service: Service;
  readonly newRequestId: () => string;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      const match =
        /^\/management\/v1\/routing-configurations\/(create|read|publish|import)$/u.exec(
          new URL(request.url).pathname,
        );
      const operation = match?.[1];
      if (request.method !== 'POST' || !operation || !operations.has(operation))
        return response(404, { error: 'not_found' });
      const requestId = ports.newRequestId();
      const accessToken = /^Bearer ([^\s,]+)$/iu.exec(
        request.headers.get('authorization') ?? '',
      )?.[1];
      const result = await ports.service.execute({
        operation: operation as ConfigurationOperation,
        requestId,
        ...(accessToken === undefined ? {} : { accessToken }),
        readInput: () => readInput(request),
      });
      return response(result.status, result.body, requestId);
    } catch {
      return response(503, { error: 'configuration_unavailable' });
    }
  };
}

/** Caller explicitly mounts this separate management boundary and owns the database lifetime. */
export function createPostgresRfc9068OwnedConfigurationHandler(
  ports: SsoAccessTokenConfiguration &
    Omit<Parameters<typeof createOwnedConfigurationService>[0], 'verifyAccessToken'> & {
      readonly newRequestId: () => string;
    },
) {
  const verifyAccessToken = createRfc9068SsoAccessTokenVerifier(ports);
  return createOwnedConfigurationHandler({
    service: createOwnedConfigurationService({ ...ports, verifyAccessToken }),
    newRequestId: ports.newRequestId,
  });
}
export function createPostgresRfc9068OwnedConfigurationServer(
  ports: Parameters<typeof createPostgresRfc9068OwnedConfigurationHandler>[0],
): Server {
  return createNodeRequestServer(createPostgresRfc9068OwnedConfigurationHandler(ports), () =>
    response(503, { error: 'configuration_unavailable' }),
  );
}
