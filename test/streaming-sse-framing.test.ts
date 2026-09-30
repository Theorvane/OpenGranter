import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSseDataEvents } from '../src/streaming/parse-sse-data-events.ts';

const encoder = new TextEncoder();

function stream(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    },
  });
}

async function collect(chunks: readonly (string | Uint8Array)[], maxBytes?: number) {
  const events: string[] = [];
  for await (const event of parseSseDataEvents(stream(chunks), maxBytes)) events.push(event);
  return events;
}

test('parses split CRLF, LF, CR, BOM, keepalive comments and multiline data', async () => {
  assert.deepEqual(
    await collect([
      '\uFEFF: OPENROUTER PROCESSING\r',
      '\n\r\ndata: first\r',
      '\ndata:  second\r',
      '\nevent: ignored\r\n\r',
      '\ndata:third\n\ndata\r\r',
    ]),
    ['first\n second', 'third', ''],
  );
});

test('decodes UTF-8 split inside a code point and drops unfinished final event', async () => {
  const bytes = encoder.encode('data: 한\n\ndata: unfinished');
  const cut = bytes.indexOf(0xed) + 1;
  assert.deepEqual(await collect([bytes.slice(0, cut), bytes.slice(cut)]), ['한']);
});

test('rejects malformed UTF-8, oversized lines and events without echoing content', async () => {
  for (const chunks of [
    [new Uint8Array([0x64, 0x61, 0x74, 0x61, 0x3a, 0xff])],
    ['data: private-payload\n\n'],
    ['data: a\ndata: b\ndata: c\ndata: d\ndata: e\n\n'],
  ]) {
    await assert.rejects(
      async () => {
        for await (const _event of parseSseDataEvents(stream(chunks), 8)) {
          // Drain the stream.
        }
      },
      (error: unknown) => error instanceof Error && error.message === 'Invalid SSE stream',
    );
  }
});

test('normal EOF releases the reader; transport errors use fixed diagnostics', async () => {
  let cancelled = false;
  const complete = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: ok\n\n'));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const results: string[] = [];
  for await (const event of parseSseDataEvents(complete)) results.push(event);
  assert.deepEqual(results, ['ok']);
  assert.equal(cancelled, false);
  assert.equal(complete.locked, false);

  const failed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('private provider response'));
    },
  });
  await assert.rejects(
    async () => {
      for await (const _event of parseSseDataEvents(failed)) {
        // The transport fails before yielding an event.
      }
    },
    { message: 'Invalid SSE stream' },
  );
});

test('pulls incrementally and cancels the source when iteration ends early', async () => {
  let pulls = 0;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode(`data: ${pulls}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  for await (const event of parseSseDataEvents(source)) {
    assert.equal(event, '1');
    break;
  }
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
});

test('rejects invalid limits without acquiring the stream', async () => {
  const source = stream(['data: accepted\n\n']);
  await assert.rejects(
    async () => {
      for await (const _event of parseSseDataEvents(source, 0)) {
        // Invalid configuration never produces an event.
      }
    },
    { message: 'Invalid SSE limit' },
  );
  assert.deepEqual(await collect(['data: accepted\n\n']), ['accepted']);
});
