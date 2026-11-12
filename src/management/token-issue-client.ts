import type { CatalogRequest } from './catalog-client.ts';
import { validCredentialId } from './token-revoke-client.ts';

export type TokenIssueResult =
  | { readonly state: 'ready'; readonly credentialId: string; readonly token: string }
  | { readonly state: 'invalid_input' | 'unauthenticated' | 'denied' | 'uncertain' | 'cancelled' };

export function validIssuance(principalId: string, expiresAt: number): boolean {
  return validCredentialId(principalId) && Number.isSafeInteger(expiresAt) && expiresAt >= 0;
}
function validToken(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > 16384) return false;
  // Share the server's opaque-string rules without imposing a different token alphabet.
  for (let offset = 0; offset < value.length; ) {
    const code = value.codePointAt(offset);
    if (code === undefined || code === 0 || (code >= 0xd800 && code <= 0xdfff)) return false;
    offset += code > 0xffff ? 2 : 1;
  }
  return true;
}

/** Caller owns the authorized request port. Never persists or retries issuance. */
export async function issueManagementToken(
  request: CatalogRequest,
  principalId: string,
  expiresAt: number,
  signal?: AbortSignal,
): Promise<TokenIssueResult> {
  if (!validIssuance(principalId, expiresAt)) return { state: 'invalid_input' };
  if (signal?.aborted) return { state: 'cancelled' };
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {
    try {
      void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {});
    } catch {
      /* locked or closed */
    }
  };
  try {
    response = await request('/management/v1/proxy-tokens', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ principalId, expiresAt }),
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) return { state: 'cancelled' };
    if (response.status === 401) return { state: 'unauthenticated' };
    if (response.status === 403) return { state: 'denied' };
    if (response.status === 400) return { state: 'invalid_input' };
    if (
      response.status !== 201 ||
      response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json' ||
      !response.body
    )
      return { state: 'uncertain' };
    reader = response.body.getReader();
    signal?.addEventListener('abort', cancel, { once: true });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    while (!signal?.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 131072) return { state: 'uncertain' };
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (signal?.aborted) return { state: 'cancelled' };
    const value: unknown = JSON.parse(text + decoder.decode());
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !('credentialId' in value) ||
      !('token' in value) ||
      !validCredentialId(value.credentialId) ||
      !validToken(value.token)
    )
      return { state: 'uncertain' };
    return { state: 'ready', credentialId: value.credentialId, token: value.token };
  } catch {
    return { state: signal?.aborted ? 'cancelled' : 'uncertain' };
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}
