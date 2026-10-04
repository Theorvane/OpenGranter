import {
  decodeOpenRouterStreamPayload,
  type OpenRouterTextStreamPayload,
  type StreamModelScope,
} from './openrouter-stream-chunks.ts';
import {
  OpenRouterStreamSequenceFailure,
  type OpenRouterTextStreamOutcome,
  OpenRouterTextStreamSequence,
} from './openrouter-stream-sequence.ts';
import { parseSseDataEvents } from './parse-sse-data-events.ts';
import { waitForStreamOperation } from './wait-for-stream-operation.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;

/** Consume a pre-authorized OpenRouter text stream with awaited delta delivery. */
export async function consumeOpenRouterTextStream(
  source: ReadableStream<Uint8Array>,
  scope: StreamModelScope,
  onDelta: (delta: Delta) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<OpenRouterTextStreamOutcome> {
  const fixedScope = Object.freeze({
    upstreamModelId: scope.upstreamModelId,
    clientModelAlias: scope.clientModelAlias,
  });
  const sequence = new OpenRouterTextStreamSequence();
  try {
    for await (const data of parseSseDataEvents(source, undefined, signal)) {
      const event = decodeOpenRouterStreamPayload(data, fixedScope);
      sequence.accept(event);
      if (event.kind === 'delta')
        await waitForStreamOperation(Promise.resolve(onDelta(event)), signal);
      if (event.kind === 'done' || event.kind === 'error') break;
    }
    return sequence.finish();
  } catch {
    sequence.discard();
    throw new OpenRouterStreamSequenceFailure();
  }
}
