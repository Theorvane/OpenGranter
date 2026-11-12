import type { CatalogRequest } from './catalog-client.ts';

export type TokenRevokeResult =
  | { readonly state: 'ready'; readonly revoked: boolean }
  | { readonly state: 'invalid_input' | 'unauthenticated' | 'denied' | 'uncertain' | 'cancelled' };

export function validCredentialId(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || value.includes('\0'))
    return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

/** An authorized application owns credentials/CSRF. Never retries a mutation. */
export async function revokeManagementToken(
  request: CatalogRequest,
  credentialId: string,
  signal?: AbortSignal,
): Promise<TokenRevokeResult> {
  if (!validCredentialId(credentialId)) return { state: 'invalid_input' };
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
    response = await request('/management/v1/proxy-tokens/revoke', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ credentialId }),
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) return { state: 'cancelled' };
    if (response.status === 401) return { state: 'unauthenticated' };
    if (response.status === 403) return { state: 'denied' };
    if (
      response.status !== 200 ||
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
      if (bytes > 4096) return { state: 'uncertain' };
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (signal?.aborted) return { state: 'cancelled' };
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'uncertain' };
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).length !== 1 ||
      !Object.hasOwn(row, 'revoked') ||
      typeof row.revoked !== 'boolean'
    )
      return { state: 'uncertain' };
    return { state: 'ready', revoked: row.revoked };
  } catch {
    return { state: signal?.aborted ? 'cancelled' : 'uncertain' };
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader?.releaseLock();
  }
}
