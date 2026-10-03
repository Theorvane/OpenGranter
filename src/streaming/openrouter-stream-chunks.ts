import { normalizeChatUsage } from '../providers/chat-usage.ts';
import { type ReasoningDetail, snapshotReasoningDetails } from '../providers/reasoning-details.ts';

type FinishReason = 'stop' | 'length' | 'content_filter';
type NormalizedUsage = ReturnType<typeof normalizeChatUsage>;

export interface StreamModelScope {
  readonly upstreamModelId: string;
  readonly clientModelAlias: string;
}

export type OpenRouterTextStreamPayload =
  | { readonly kind: 'done' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'delta';
      readonly id: string;
      readonly created: number;
      readonly model: string;
      readonly systemFingerprint?: string | null;
      readonly serviceTier?: string | null;
      readonly role?: 'assistant';
      readonly content?: string | null;
      readonly refusal?: string | null;
      readonly reasoning?: string | null;
      readonly reasoningDetails?: readonly ReasoningDetail[];
      readonly finishReason: FinishReason | null;
      readonly nativeFinishReason?: string | null;
    }
  | {
      readonly kind: 'usage';
      readonly id: string;
      readonly created: number;
      readonly model: string;
      readonly systemFingerprint?: string | null;
      readonly serviceTier?: string | null;
      readonly finishReason: FinishReason | null;
      readonly nativeFinishReason?: string | null;
      readonly usage: NormalizedUsage;
    };

function invalidChunk(): Error {
  return new Error('Invalid OpenRouter stream chunk');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

/** Validate one framed OpenRouter chat payload inside the authorized model scope. */
export function decodeOpenRouterStreamPayload(
  payload: string,
  scope: StreamModelScope,
): OpenRouterTextStreamPayload {
  if (
    typeof payload !== 'string' ||
    typeof scope.upstreamModelId !== 'string' ||
    !scope.upstreamModelId ||
    typeof scope.clientModelAlias !== 'string' ||
    !scope.clientModelAlias
  )
    throw invalidChunk();
  if (payload === '[DONE]') return Object.freeze({ kind: 'done' });

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    throw invalidChunk();
  }
  const value = record(parsed);
  if (!value) throw invalidChunk();
  // A committed HTTP 200 may carry an error as its first and only SSE event.
  if (hasOwn(value, 'error')) return Object.freeze({ kind: 'error' });

  const choices = value.choices;
  const systemFingerprint = value.system_fingerprint;
  const serviceTier = value.service_tier;
  if (
    (systemFingerprint !== undefined &&
      systemFingerprint !== null &&
      typeof systemFingerprint !== 'string') ||
    (serviceTier !== undefined && serviceTier !== null && typeof serviceTier !== 'string') ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 256 ||
    value.object !== 'chat.completion.chunk' ||
    typeof value.created !== 'number' ||
    !Number.isSafeInteger(value.created) ||
    value.created < 0 ||
    value.model !== scope.upstreamModelId ||
    !Array.isArray(choices)
  )
    throw invalidChunk();

  const common = {
    id: value.id,
    created: value.created,
    model: scope.clientModelAlias,
    ...(systemFingerprint === undefined ? {} : { systemFingerprint }),
    ...(serviceTier === undefined ? {} : { serviceTier }),
  };
  if (choices.length === 0) {
    if (!hasOwn(value, 'usage')) throw invalidChunk();
    const usage = normalizeChatUsage(value.usage);
    return Object.freeze({
      kind: 'usage',
      ...common,
      finishReason: null,
      usage: usage && Object.freeze(usage),
    });
  }

  const choice = choices.length === 1 ? record(choices[0]) : undefined;
  const delta = record(choice?.delta);
  const finish = choice?.finish_reason;
  const nativeFinishReason = choice?.native_finish_reason;
  if (
    (nativeFinishReason !== undefined &&
      nativeFinishReason !== null &&
      typeof nativeFinishReason !== 'string') ||
    !choice ||
    choice.index !== 0 ||
    !delta ||
    Object.keys(delta).some(
      (key) =>
        key !== 'role' &&
        key !== 'content' &&
        key !== 'refusal' &&
        key !== 'reasoning' &&
        key !== 'reasoning_details',
    ) ||
    (delta.role !== undefined && delta.role !== 'assistant') ||
    (delta.content !== undefined && delta.content !== null && typeof delta.content !== 'string') ||
    (delta.refusal !== undefined && delta.refusal !== null && typeof delta.refusal !== 'string') ||
    (delta.reasoning !== undefined &&
      delta.reasoning !== null &&
      typeof delta.reasoning !== 'string') ||
    (finish !== null && finish !== 'stop' && finish !== 'length' && finish !== 'content_filter')
  )
    throw invalidChunk();

  const hasDetails = hasOwn(delta, 'reasoning_details');
  const details = hasDetails ? snapshotReasoningDetails(delta.reasoning_details) : undefined;
  if (hasDetails && details === undefined) throw invalidChunk();
  if (hasOwn(value, 'usage')) {
    if (
      hasDetails ||
      finish === null ||
      (delta.content !== undefined && delta.content !== null && delta.content !== '') ||
      (delta.refusal !== undefined && delta.refusal !== null && delta.refusal !== '') ||
      (delta.reasoning !== undefined && delta.reasoning !== null && delta.reasoning !== '')
    )
      throw invalidChunk();
    const usage = normalizeChatUsage(value.usage);
    return Object.freeze({
      kind: 'usage',
      ...common,
      finishReason: finish,
      ...(nativeFinishReason === undefined ? {} : { nativeFinishReason }),
      usage: usage && Object.freeze(usage),
    });
  }
  return Object.freeze({
    kind: 'delta',
    ...common,
    ...(delta.role === undefined ? {} : { role: delta.role }),
    ...(delta.content === undefined ? {} : { content: delta.content }),
    ...(delta.refusal === undefined ? {} : { refusal: delta.refusal }),
    ...(delta.reasoning === undefined ? {} : { reasoning: delta.reasoning }),
    ...(details === undefined ? {} : { reasoningDetails: details }),
    finishReason: finish,
    ...(nativeFinishReason === undefined ? {} : { nativeFinishReason }),
  });
}
