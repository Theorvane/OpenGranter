const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024;
const MAX_CONFIGURED_EVENT_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

function invalidStream(): Error {
  return new Error('Invalid SSE stream');
}

/** Read complete SSE data payloads without interpreting their protocol-specific contents. */
export async function* parseSseDataEvents(
  source: ReadableStream<Uint8Array>,
  maxEventBytes = DEFAULT_MAX_EVENT_BYTES,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (
    !Number.isSafeInteger(maxEventBytes) ||
    maxEventBytes < 1 ||
    maxEventBytes > MAX_CONFIGURED_EVENT_BYTES
  ) {
    throw new TypeError('Invalid SSE limit');
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = source.getReader();
  } catch {
    throw invalidStream();
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let lineBytes = 0;
  let data: string[] = [];
  let eventBytes = 0;
  let afterCr = false;
  let atStart = true;
  let complete = false;
  let cancelled = false;
  const abort = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  function consumeLine(): string | undefined {
    const current = line;
    line = '';
    lineBytes = 0;
    if (current === '') {
      if (data.length === 0) return undefined;
      const event = data.join('\n');
      data = [];
      eventBytes = 0;
      return event;
    }
    if (current.startsWith(':')) return undefined;
    const colon = current.indexOf(':');
    const field = colon < 0 ? current : current.slice(0, colon);
    if (field !== 'data') return undefined;
    const raw = colon < 0 ? '' : current.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    eventBytes += encoder.encode(value).byteLength + (data.length === 0 ? 0 : 1);
    if (eventBytes > maxEventBytes) throw invalidStream();
    data.push(value);
    return undefined;
  }

  try {
    for (;;) {
      if (signal?.aborted) throw invalidStream();
      const next = await reader.read();
      if (signal?.aborted) throw invalidStream();
      if (next.done) {
        decoder.decode();
        complete = true;
        break;
      }
      const decoded = decoder.decode(next.value, { stream: true });
      for (const char of decoded) {
        if (signal?.aborted) throw invalidStream();
        if (atStart) {
          atStart = false;
          if (char === '\uFEFF') continue;
        }
        if (afterCr) {
          afterCr = false;
          if (char === '\n') continue;
        }
        if (char === '\r' || char === '\n') {
          const event = consumeLine();
          afterCr = char === '\r';
          if (event !== undefined) yield event;
          continue;
        }
        line += char;
        const point = char.codePointAt(0) ?? 0;
        lineBytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        // Allow the `data: ` framing bytes around a payload at its exact limit.
        if (lineBytes > maxEventBytes + 6) throw invalidStream();
      }
    }
  } catch {
    throw invalidStream();
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!complete && !cancelled) {
      const cleanup = reader.cancel().catch(() => {});
      // Signal-aware invocation must not hang awaiting an uncooperative source cleanup.
      if (!signal) await cleanup;
    }
    reader.releaseLock();
  }
}
