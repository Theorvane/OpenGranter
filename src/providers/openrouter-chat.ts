import type { ChatRequest } from '../gateway/chat-handler.ts';
import { type ChatMessage, snapshotChatMessages } from '../gateway/chat-messages.ts';
import {
  resolveOutputTokenLimit,
  snapshotResponseFormat,
  snapshotStopSequences,
  validPenalty,
  validSeed,
  validSingleChoice,
  validTemperature,
  validTopK,
  validTopP,
} from '../gateway/chat-parameters.ts';
import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';
import { normalizeAssistantResponse } from './assistant-response.ts';
import type { ChatCompletion } from './direct-chat.ts';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._/+:-]*$/u;

export interface OpenRouterChatAttempt {
  /** An administrator-approved, fixed OpenRouter model slug for this attempt. */
  readonly upstreamModelId: string;
  /** Exact OpenRouter slugs mapped from this attempt's IAM-authorized final providers. */
  readonly authorizedProviderSlugs: readonly string[];
}

export interface OpenRouterChatPorts {
  readonly credentialRef: string;
  readonly resolveSecret: (credentialRef: string) => Promise<string | undefined>;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export type OpenRouterFailureCategory =
  | 'configuration'
  | 'credential'
  | 'rate-limit'
  | 'server-error'
  | 'timeout'
  | 'upstream';

/** Safe failure metadata for a single delegated upstream attempt. */
export class OpenRouterChatFailure extends Error {
  readonly category: OpenRouterFailureCategory;
  readonly responseStarted: boolean;
  readonly possiblyBilled: boolean;

  constructor(
    category: OpenRouterFailureCategory,
    responseStarted: boolean,
    possiblyBilled: boolean,
  ) {
    super('OpenRouter chat attempt failed');
    this.name = 'OpenRouterChatFailure';
    this.category = category;
    this.responseStarted = responseStarted;
    this.possiblyBilled = possiblyBilled;
  }
}

function fail(
  category: OpenRouterFailureCategory,
  responseStarted = false,
  possiblyBilled = false,
): never {
  throw new OpenRouterChatFailure(category, responseStarted, possiblyBilled);
}

export function validOpenRouterSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && SAFE_SLUG.test(value);
}

function validAttempt(value: OpenRouterChatAttempt): boolean {
  return (
    validOpenRouterSlug(value.upstreamModelId) &&
    Array.isArray(value.authorizedProviderSlugs) &&
    value.authorizedProviderSlugs.length > 0 &&
    value.authorizedProviderSlugs.every(validOpenRouterSlug) &&
    new Set(value.authorizedProviderSlugs).size === value.authorizedProviderSlugs.length
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalize(
  body: unknown,
  request: ChatRequest,
  attempt: OpenRouterChatAttempt,
): ChatCompletion {
  const value = record(body);
  const choices = Array.isArray(value?.choices) ? value.choices : undefined;
  const first = record(choices?.[0]);
  const message = normalizeAssistantResponse(record(first?.message), first?.finish_reason);
  if (
    choices?.length !== 1 ||
    typeof value?.id !== 'string' ||
    !value.id ||
    count(value.created) === undefined ||
    value.model !== attempt.upstreamModelId ||
    first?.index !== 0 ||
    !message
  )
    fail('upstream', true, true);

  const stats = normalizeProviderUsage(value.usage);
  const finish = first.finish_reason;
  if (finish !== 'stop' && finish !== 'length' && finish !== 'content_filter' && finish !== null)
    fail('upstream', true, true);
  return {
    id: value.id,
    object: 'chat.completion',
    created: value.created as number,
    model: request.model,
    choices: [{ index: 0, message, finish_reason: finish }],
    ...(stats ? { usage: stats } : {}),
  };
}

/** Invoke one previously authorized delegated route without forwarding caller routing controls. */
export function createOpenRouterChatInvoker(
  ports: OpenRouterChatPorts,
): (attempt: OpenRouterChatAttempt, request: ChatRequest) => Promise<ChatCompletion> {
  return async (attempt, request) => {
    const topK = request.top_k ?? undefined;
    if (!validTopK(topK)) fail('configuration');

    const seed = request.seed ?? undefined;
    if (!validSeed(seed)) fail('configuration');
    const frequencyPenalty = request.frequency_penalty ?? undefined;
    const presencePenalty = request.presence_penalty ?? undefined;
    if (!validPenalty(frequencyPenalty) || !validPenalty(presencePenalty)) fail('configuration');
    let responseFormat: ReturnType<typeof snapshotResponseFormat>;
    try {
      responseFormat = snapshotResponseFormat(request.response_format);
    } catch {
      fail('configuration');
    }
    const n = request.n;
    if (!validSingleChoice(n)) fail('configuration');
    const topP = request.top_p ?? undefined;
    if (!validTopP(topP)) fail('configuration');
    const temperature = request.temperature ?? undefined;
    if (!validTemperature(temperature)) fail('configuration');
    let maxTokens: number | undefined;
    try {
      maxTokens = resolveOutputTokenLimit(request.max_tokens, request.max_completion_tokens);
    } catch {
      fail('configuration');
    }
    let stop: ReturnType<typeof snapshotStopSequences>;
    try {
      stop = snapshotStopSequences(request.stop);
    } catch {
      fail('configuration');
    }
    const configuredTimeout = ports.timeoutMs;
    const timeoutMs = configuredTimeout === undefined ? 30_000 : configuredTimeout;
    if (
      !validAttempt(attempt) ||
      !ports.credentialRef ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 2_147_483_647
    )
      fail('configuration');
    let messages: readonly ChatMessage[];
    try {
      messages = snapshotChatMessages(request.messages);
    } catch {
      fail('configuration');
    }
    let key: string | undefined;
    try {
      key = await ports.resolveSecret(ports.credentialRef);
    } catch {
      fail('credential');
    }
    if (!key) fail('credential');

    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await (ports.fetcher ?? fetch)(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: attempt.upstreamModelId,
          messages,
          stream: false,
          ...(n === undefined ? {} : { n }),
          ...(seed === undefined ? {} : { seed }),
          ...(frequencyPenalty === undefined ? {} : { frequency_penalty: frequencyPenalty }),
          ...(presencePenalty === undefined ? {} : { presence_penalty: presencePenalty }),
          ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
          ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
          ...(temperature === undefined ? {} : { temperature }),
          ...(topP === undefined ? {} : { top_p: topP }),
          ...(topK === undefined ? {} : { top_k: topK }),
          ...(stop === undefined ? {} : { stop }),
          provider: { only: attempt.authorizedProviderSlugs },
        }),
        redirect: 'error',
        signal: timeout,
      });
    } catch (error) {
      if (
        timeout.aborted ||
        (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
      ) {
        fail('timeout', false, true);
      }
      fail('upstream', false, true);
    }
    if (response.status === 429) fail('rate-limit', true, true);
    if (response.status >= 500) fail('server-error', true, true);
    if (!response.ok) fail('upstream', true, true);
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      fail('upstream', true, true);
    }
    return normalize(body, request, attempt);
  };
}
