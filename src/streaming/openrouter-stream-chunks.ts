import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';

type FinishReason = 'stop' | 'length' | 'content_filter';
type NormalizedUsage = ReturnType<typeof normalizeProviderUsage>;

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
      readonly role?: 'assistant';
      readonly content?: string | null;
      readonly finishReason: FinishReason | null;
    }
  | {
      readonly kind: 'usage';
      readonly id: string;
      readonly created: number;
      readonly model: string;
      readonly systemFingerprint?: string | null;
      readonly finishReason: FinishReason | null;
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
  if (
    (systemFingerprint !== undefined &&
      systemFingerprint !== null &&
      typeof systemFingerprint !== 'string') ||
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
  };
  if (choices.length === 0) {
    if (!hasOwn(value, 'usage')) throw invalidChunk();
    const usage = normalizeProviderUsage(value.usage);
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
  if (
    !choice ||
    choice.index !== 0 ||
    !delta ||
    Object.keys(delta).some((key) => key !== 'role' && key !== 'content') ||
    (delta.role !== undefined && delta.role !== 'assistant') ||
    (delta.content !== undefined && delta.content !== null && typeof delta.content !== 'string') ||
    (finish !== null && finish !== 'stop' && finish !== 'length' && finish !== 'content_filter')
  )
    throw invalidChunk();

  if (hasOwn(value, 'usage')) {
    if (
      finish === null ||
      (delta.content !== undefined && delta.content !== null && delta.content !== '')
    )
      throw invalidChunk();
    const usage = normalizeProviderUsage(value.usage);
    return Object.freeze({
      kind: 'usage',
      ...common,
      finishReason: finish,
      usage: usage && Object.freeze(usage),
    });
  }
  return Object.freeze({
    kind: 'delta',
    ...common,
    ...(delta.role === undefined ? {} : { role: delta.role }),
    ...(delta.content === undefined ? {} : { content: delta.content }),
    finishReason: finish,
  });
}
