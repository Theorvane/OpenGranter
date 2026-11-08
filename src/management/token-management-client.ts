import type { CatalogRequest } from './catalog-client.ts';

export type TokenMutationFailure = {
  readonly state:
    | 'invalid_input'
    | 'invalid_request'
    | 'unauthenticated'
    | 'denied'
    | 'busy'
    | 'disposed'
    | 'outcome_unknown'
    | 'reconciliation_required';
};
export type TokenIssueResult =
  | { readonly state: 'issued'; readonly credentialId: string; readonly token: string }
  | TokenMutationFailure;
export type TokenRevokeResult =
  | { readonly state: 'revoked'; readonly revoked: boolean }
  | TokenMutationFailure;

function id(value: unknown, maximum = 256): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes('\0') &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function discard(response: Response) {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Cleanup cannot expose a private error or change a mutation outcome.
  }
}
const maximumBytes = 65536;
async function read(response: Response, signal: AbortSignal): Promise<unknown> {
  const media = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const declared = response.headers.get('content-length');
  if (
    media !== 'application/json' ||
    (declared !== null && /^\d+$/u.test(declared) && Number(declared) > maximumBytes) ||
    !response.body
  ) {
    discard(response);
    throw Error('Invalid response');
  }
  const reader = response.body.getReader();
  const cancel = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      // Best-effort only; the outer abort race settles independently.
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(maximumBytes);
  let size = 0;
  try {
    if (signal.aborted) throw Error('Interrupted');
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw Error('Interrupted');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) throw Error('Response limit');
      bytes.set(chunk.value, size - chunk.value.byteLength);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    bytes.fill(0);
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Trusted transport only. No login, bearer storage, persistence or automatic retry.
 * The caller owns expiry/logout disposal and the lifetime of the returned one-time
 * secret. Unknown outcome means reconcile: abortion does not certify rollback.
 */
export function createManagementTokenClient(request: CatalogRequest) {
  let disposed = false;
  let uncertain = false;
  let pending: AbortController | undefined;
  async function mutate<T extends TokenIssueResult | TokenRevokeResult>(
    path: string,
    body: string,
    status: number,
    project: (value: unknown) => T | undefined,
  ): Promise<T | TokenMutationFailure> {
    if (disposed) return { state: 'disposed' };
    if (pending) return { state: 'busy' };
    if (uncertain) return { state: 'reconciliation_required' };
    const controller = new AbortController();
    pending = controller;
    let onAbort: () => void = () => {};
    const interrupted = new Promise<TokenMutationFailure>((resolve) => {
      onAbort = () => resolve({ state: 'outcome_unknown' });
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), 30000);
    const operation = async (): Promise<T | TokenMutationFailure> => {
      try {
        const response = await request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body,
          cache: 'no-store',
          redirect: 'error',
          credentials: 'omit',
          signal: controller.signal,
        });
        if (disposed || controller.signal.aborted) {
          discard(response);
          return { state: 'outcome_unknown' };
        }
        if (response.status !== status) {
          discard(response);
          return {
            state:
              response.status === 400
                ? 'invalid_request'
                : response.status === 401
                  ? 'unauthenticated'
                  : response.status === 403
                    ? 'denied'
                    : 'outcome_unknown',
          };
        }
        const value = await read(response, controller.signal);
        if (disposed || controller.signal.aborted) return { state: 'outcome_unknown' };
        return project(value) ?? { state: 'outcome_unknown' };
      } catch {
        return { state: 'outcome_unknown' };
      }
    };
    try {
      const result = await Promise.race([operation(), interrupted]);
      if (result.state === 'outcome_unknown') uncertain = true;
      return result;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      if (pending === controller) pending = undefined;
    }
  }
  return {
    async issue(input: {
      readonly principalId: string;
      readonly expiresAt: number;
    }): Promise<TokenIssueResult> {
      if (disposed) return { state: 'disposed' };
      let body: string;
      try {
        if (
          !object(input) ||
          Object.keys(input).length !== 2 ||
          !Object.hasOwn(input, 'principalId') ||
          !Object.hasOwn(input, 'expiresAt')
        )
          return { state: 'invalid_input' };
        const { principalId, expiresAt } = input;
        if (!id(principalId) || !Number.isSafeInteger(expiresAt) || expiresAt < 0)
          return { state: 'invalid_input' };
        body = JSON.stringify({ principalId, expiresAt });
      } catch {
        return { state: 'invalid_input' };
      }
      return mutate('/management/v1/proxy-tokens', body, 201, (value) => {
        if (!object(value) || !id(value.credentialId) || !id(value.token, 16384)) return;
        return { state: 'issued', credentialId: value.credentialId, token: value.token };
      });
    },
    async revoke(input: { readonly credentialId: string }): Promise<TokenRevokeResult> {
      if (disposed) return { state: 'disposed' };
      let body: string;
      try {
        if (
          !object(input) ||
          Object.keys(input).length !== 1 ||
          !Object.hasOwn(input, 'credentialId')
        )
          return { state: 'invalid_input' };
        const { credentialId } = input;
        if (!id(credentialId)) return { state: 'invalid_input' };
        body = JSON.stringify({ credentialId });
      } catch {
        return { state: 'invalid_input' };
      }
      return mutate('/management/v1/proxy-tokens/revoke', body, 200, (value) => {
        if (!object(value) || typeof value.revoked !== 'boolean') return;
        return { state: 'revoked', revoked: value.revoked };
      });
    },
    dispose() {
      disposed = true;
      pending?.abort();
    },
  };
}
