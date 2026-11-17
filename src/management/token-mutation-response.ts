/** Fetch-decoded JSON only; a failed read cannot certify a mutation outcome. */
export async function readTokenMutationResponse(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const declared = response.headers.get('content-length');
  let expected: number | undefined;
  if ((!encoding || encoding === 'identity') && declared !== null) {
    expected = Number(declared);
    if (!/^\d+$/u.test(declared) || !Number.isSafeInteger(expected) || expected > maxBytes)
      throw new Error('Invalid mutation response length');
  }
  if (signal.aborted || !response.body) throw new Error('Mutation response interrupted');
  const reader = response.body.getReader();
  const cancel = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      // Producer cleanup cannot delay the safe outcome.
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let text = '';
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('Mutation response interrupted');
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes || (expected !== undefined && size > expected))
        throw new Error('Mutation response exceeds length');
      text += decoder.decode(value, { stream: true });
    }
    if (signal.aborted || (expected !== undefined && size !== expected))
      throw new Error('Incomplete mutation response');
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
