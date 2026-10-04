import {
  type OpenRouterFunctionStreamOutcome,
  OpenRouterFunctionStreamSequence,
} from './openrouter-function-stream-sequence.ts';
import {
  decodeOpenRouterFunctionStreamPayload,
  type OpenRouterFunctionStreamPayload,
  type StreamModelScope,
} from './openrouter-stream-chunks.ts';
import { OpenRouterStreamSequenceFailure } from './openrouter-stream-sequence.ts';
import { parseSseDataEvents } from './parse-sse-data-events.ts';
import { waitForStreamOperation } from './wait-for-stream-operation.ts';

type Delta = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>;

/** Internal pre-authorized stream; calls/deltas are response content, never operational metadata. */
export async function consumeOpenRouterFunctionStream(
  source: ReadableStream<Uint8Array>,
  scope: StreamModelScope,
  onDelta: (delta: Delta) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<OpenRouterFunctionStreamOutcome> {
  const fixedScope = Object.freeze({
    upstreamModelId: scope.upstreamModelId,
    clientModelAlias: scope.clientModelAlias,
  });
  const sequence = new OpenRouterFunctionStreamSequence();
  try {
    for await (const data of parseSseDataEvents(source, undefined, signal)) {
      const event = decodeOpenRouterFunctionStreamPayload(data, fixedScope);
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
