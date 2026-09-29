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
import type { RouteCandidate } from '../routing/authorize-candidates.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';
import { type AssistantResponse, normalizeAssistantResponse } from './assistant-response.ts';

export interface DirectProviderRegistration {
  readonly providerId: string;
  readonly kind: 'openai' | 'anthropic' | 'google';
  readonly credentialRef: string;
  readonly maxOutputTokens?: number;
}

export class InvalidDirectProviderConfiguration extends Error {
  constructor() {
    super('Invalid direct provider configuration');
    this.name = 'InvalidDirectProviderConfiguration';
  }
}

export function snapshotDirectProviderRegistrations(input: unknown): DirectProviderRegistration[] {
  if (!Array.isArray(input)) throw new InvalidDirectProviderConfiguration();
  const ids = new Set<string>();
  return input.map((value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InvalidDirectProviderConfiguration();
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.providerId !== 'string' ||
      item.providerId.length > 256 ||
      !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(item.providerId) ||
      ids.has(item.providerId) ||
      (item.kind !== 'openai' && item.kind !== 'anthropic' && item.kind !== 'google') ||
      typeof item.credentialRef !== 'string' ||
      item.credentialRef.length > 1024 ||
      !/^[^\s\p{Cc}]+$/u.test(item.credentialRef)
    )
      throw new InvalidDirectProviderConfiguration();
    if (
      (item.kind === 'anthropic' || item.maxOutputTokens !== undefined) &&
      (typeof item.maxOutputTokens !== 'number' ||
        !Number.isSafeInteger(item.maxOutputTokens) ||
        item.maxOutputTokens <= 0)
    ) {
      throw new InvalidDirectProviderConfiguration();
    }
    ids.add(item.providerId);
    return {
      providerId: item.providerId,
      kind: item.kind,
      credentialRef: item.credentialRef,
      ...(typeof item.maxOutputTokens === 'number'
        ? { maxOutputTokens: item.maxOutputTokens }
        : {}),
    };
  });
}

export interface DirectChatPorts {
  readonly registrations: readonly DirectProviderRegistration[];
  readonly resolveSecret: (credentialRef: string) => Promise<string | undefined>;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ChatCompletion {
  readonly id: string;
  readonly object: 'chat.completion';
  readonly created: number;
  readonly model: string;
  readonly choices: readonly [
    {
      readonly index: 0;
      readonly message: AssistantResponse;
      readonly finish_reason: 'stop' | 'length' | 'content_filter' | null;
    },
  ];
  readonly usage?: {
    readonly prompt_tokens?: number | null;
    readonly completion_tokens?: number | null;
    readonly total_tokens?: number | null;
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function items(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function fail(
  category: 'rate-limit' | 'server-error' | 'timeout' | 'other',
  possiblyBilled = false,
  responseStarted = false,
): never {
  throw new DirectProviderFailure(category, responseStarted, possiblyBilled);
}
function completion(
  id: unknown,
  created: unknown,
  model: string,
  content: unknown,
  finish: 'stop' | 'length' | 'content_filter' | null,
  stats?: ChatCompletion['usage'],
  assistant?: AssistantResponse,
): ChatCompletion {
  const message = assistant ?? normalizeAssistantResponse({ role: 'assistant', content }, finish);
  if (!message) fail('other');
  return {
    id: typeof id === 'string' && id ? id : `direct-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: count(created) ?? Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finish,
      },
    ],
    ...(stats ? { usage: stats } : {}),
  };
}
function normalize(
  kind: DirectProviderRegistration['kind'],
  body: unknown,
  model: string,
): ChatCompletion {
  const value = record(body);
  if (!value) fail('other');
  if (kind === 'openai') {
    const choices = items(value.choices);
    const first = record(choices?.[0]);
    if (choices?.length !== 1 || first?.index !== 0) fail('other');
    const message = normalizeAssistantResponse(record(first.message), first.finish_reason);
    if (!message) fail('other');
    const finish =
      first.finish_reason === 'stop' ||
      first.finish_reason === 'length' ||
      first.finish_reason === 'content_filter'
        ? first.finish_reason
        : null;
    return completion(
      value.id,
      value.created,
      model,
      message.content,
      finish,
      normalizeProviderUsage(value.usage),
      message,
    );
  }
  if (kind === 'anthropic') {
    const refusal = value.stop_reason === 'refusal';
    const blocks = items(value.content);
    if (
      !blocks ||
      (!refusal && blocks.length === 0) ||
      blocks.some(
        (block) => record(block)?.type !== 'text' || typeof record(block)?.text !== 'string',
      )
    )
      fail('other');
    if (refusal) {
      return completion(
        value.id,
        undefined,
        model,
        null,
        'content_filter',
        normalizeProviderUsage(value.usage, ['input_tokens', 'output_tokens']),
        { role: 'assistant', content: null, refusal: null },
      );
    }
    return completion(
      value.id,
      undefined,
      model,
      blocks.map((block) => record(block)?.text).join(''),
      value.stop_reason === 'max_tokens'
        ? 'length'
        : value.stop_reason === 'end_turn' || value.stop_reason === 'stop_sequence'
          ? 'stop'
          : null,
      normalizeProviderUsage(value.usage, ['input_tokens', 'output_tokens']),
    );
  }
  const googleUsage = normalizeProviderUsage(value.usageMetadata, [
    'promptTokenCount',
    'candidatesTokenCount',
    'totalTokenCount',
  ]);
  const candidates = items(value.candidates);
  if (record(value.promptFeedback)?.blockReason === 'SAFETY') {
    if (value.candidates !== undefined && candidates?.length !== 0) fail('other');
    return completion(value.responseId, undefined, model, null, 'content_filter', googleUsage);
  }
  const first = record(candidates?.[0]);
  if (candidates?.length !== 1 || !first || (first.index !== undefined && first.index !== 0))
    fail('other');
  if (first.finishReason === 'SAFETY') {
    if (first.content !== undefined) {
      const content = record(first.content);
      if (
        !content ||
        Object.keys(content).some((key) => key !== 'role' && key !== 'parts') ||
        (content.role !== undefined && content.role !== 'model') ||
        (content.parts !== undefined &&
          (!Array.isArray(content.parts) || content.parts.length !== 0))
      )
        fail('other');
    }
    return completion(value.responseId, undefined, model, null, 'content_filter', googleUsage);
  }
  const parts = items(record(first?.content)?.parts);
  if (!parts || parts.length === 0 || parts.some((part) => typeof record(part)?.text !== 'string'))
    fail('other');
  return completion(
    value.responseId,
    undefined,
    model,
    parts.map((part) => record(part)?.text).join(''),
    first?.finishReason === 'MAX_TOKENS'
      ? 'length'
      : first?.finishReason === 'STOP'
        ? 'stop'
        : null,
    googleUsage,
  );
}

function prepare(
  registration: DirectProviderRegistration,
  candidate: RouteCandidate,
  inputMessages: readonly ChatMessage[],
  key: string,
  maxTokens: number | undefined,
  stop: ReturnType<typeof snapshotStopSequences>,
  temperature: number | undefined,
  topP: number | undefined,
  n: 1 | undefined,
  frequencyPenalty: number | undefined,
  presencePenalty: number | undefined,
  responseFormat: ReturnType<typeof snapshotResponseFormat>,
  topK: number | undefined,

  seed: number | undefined,
): { url: string; headers: Record<string, string>; body: object } {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const outputLimit =
    maxTokens === undefined
      ? undefined
      : Math.min(maxTokens, registration.maxOutputTokens ?? maxTokens);
  if (registration.kind === 'openai') {
    headers.authorization = `Bearer ${key}`;
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers,
      body: {
        model: candidate.upstreamModelId,
        messages: inputMessages,
        stream: false,
        ...(n === undefined ? {} : { n }),
        ...(seed === undefined ? {} : { seed }),
        ...(frequencyPenalty === undefined ? {} : { frequency_penalty: frequencyPenalty }),
        ...(presencePenalty === undefined ? {} : { presence_penalty: presencePenalty }),
        ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
        ...(outputLimit === undefined ? {} : { max_tokens: outputLimit }),
        ...(temperature === undefined ? {} : { temperature }),
        ...(topP === undefined ? {} : { top_p: topP }),
        ...(stop === undefined ? {} : { stop }),
      },
    };
  }
  const system = inputMessages.filter(
    (message) => message.role === 'system' || message.role === 'developer',
  );
  const messages = inputMessages.filter(
    (message) => message.role !== 'system' && message.role !== 'developer',
  );
  if (
    messages.length === 0 ||
    inputMessages
      .slice(system.length)
      .some((message) => message.role === 'system' || message.role === 'developer')
  )
    fail('other');
  if (registration.kind === 'anthropic') {
    if (
      !Number.isSafeInteger(registration.maxOutputTokens) ||
      (registration.maxOutputTokens ?? 0) <= 0
    )
      fail('other');
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers,
      body: {
        model: candidate.upstreamModelId,
        max_tokens: outputLimit ?? registration.maxOutputTokens,
        ...(temperature === undefined ? {} : { temperature }),
        ...(topP === undefined ? {} : { top_p: topP }),
        ...(topK === undefined ? {} : { top_k: topK }),
        ...(stop === undefined ? {} : { stop_sequences: typeof stop === 'string' ? [stop] : stop }),
        ...(system.length ? { system: system.map((message) => message.content).join('\n') } : {}),
        messages,
      },
    };
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(candidate.upstreamModelId)) fail('other');
  headers['x-goog-api-key'] = key;
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${candidate.upstreamModelId}:generateContent`,
    headers,
    body: {
      ...(outputLimit === undefined &&
      stop === undefined &&
      temperature === undefined &&
      topP === undefined &&
      n === undefined &&
      frequencyPenalty === undefined &&
      presencePenalty === undefined &&
      responseFormat === undefined &&
      topK === undefined &&
      seed === undefined
        ? {}
        : {
            generationConfig: {
              ...(topK === undefined ? {} : { topK }),
              ...(seed === undefined ? {} : { seed }),
              ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
              ...(presencePenalty === undefined ? {} : { presencePenalty }),
              ...(responseFormat === undefined
                ? {}
                : {
                    responseMimeType:
                      responseFormat.type === 'text' ? 'text/plain' : 'application/json',
                  }),
              ...(n === undefined ? {} : { candidateCount: n }),
              ...(topP === undefined ? {} : { topP }),
              ...(temperature === undefined ? {} : { temperature }),
              ...(outputLimit === undefined ? {} : { maxOutputTokens: outputLimit }),
              ...(stop === undefined
                ? {}
                : { stopSequences: typeof stop === 'string' ? [stop] : stop }),
            },
          }),
      ...(system.length
        ? {
            systemInstruction: {
              parts: [{ text: system.map((message) => message.content).join('\n') }],
            },
          }
        : {}),
      contents: messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
    },
  };
}

/** Invoke only an administrator-registered direct provider through its fixed official host. */
export function createDirectChatInvoker(
  ports: DirectChatPorts,
): (candidate: RouteCandidate, request: ChatRequest) => Promise<ChatCompletion> {
  const registrations = snapshotDirectProviderRegistrations(ports.registrations);
  return async (candidate, request) => {
    const registration = registrations.find((item) => item.providerId === candidate.providerId);
    if (!registration || candidate.kind !== 'managed') fail('other');
    const configuredTimeout = ports.timeoutMs;
    const timeoutMs = configuredTimeout === undefined ? 30_000 : configuredTimeout;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
      fail('other');
    const topK = request.top_k ?? undefined;
    if (
      !validTopK(topK) ||
      (topK !== undefined &&
        (registration.kind === 'openai' || (registration.kind === 'google' && topK > 2147483647)))
    )
      fail('other');
    const seed = request.seed ?? undefined;
    if (
      !validSeed(seed) ||
      (seed !== undefined &&
        (registration.kind === 'anthropic' ||
          (registration.kind === 'google' && (seed < -2147483648 || seed > 2147483647))))
    )
      fail('other');
    const frequencyPenalty = request.frequency_penalty ?? undefined;
    const presencePenalty = request.presence_penalty ?? undefined;
    if (
      !validPenalty(frequencyPenalty) ||
      !validPenalty(presencePenalty) ||
      (registration.kind === 'anthropic' &&
        (frequencyPenalty !== undefined || presencePenalty !== undefined))
    )
      fail('other');
    let responseFormat: ReturnType<typeof snapshotResponseFormat>;
    try {
      responseFormat = snapshotResponseFormat(request.response_format);
    } catch {
      fail('other');
    }
    if (registration.kind === 'anthropic' && responseFormat?.type === 'json_object') fail('other');
    const n = request.n;
    if (!validSingleChoice(n)) fail('other');
    const topP = request.top_p ?? undefined;
    if (!validTopP(topP)) fail('other');
    const temperature = request.temperature ?? undefined;
    if (!validTemperature(temperature, registration.kind === 'anthropic' ? 1 : 2)) fail('other');
    let maxTokens: number | undefined;
    try {
      maxTokens = resolveOutputTokenLimit(request.max_tokens, request.max_completion_tokens);
    } catch {
      fail('other');
    }
    let stop: ReturnType<typeof snapshotStopSequences>;
    try {
      stop = snapshotStopSequences(request.stop);
    } catch {
      fail('other');
    }
    let messages: readonly ChatMessage[];
    try {
      messages = snapshotChatMessages(request.messages);
    } catch {
      fail('other');
    }
    let key: string | undefined;
    try {
      key = await ports.resolveSecret(registration.credentialRef);
    } catch {
      fail('other');
    }
    if (!key) fail('other');
    const prepared = prepare(
      registration,
      candidate,
      messages,
      key,
      maxTokens,
      stop,
      temperature,
      topP,
      n,
      frequencyPenalty,
      presencePenalty,
      responseFormat,
      topK,

      seed,
    );
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await (ports.fetcher ?? fetch)(prepared.url, {
        method: 'POST',
        headers: prepared.headers,
        body: JSON.stringify(prepared.body),
        redirect: 'error',
        signal: timeout,
      });
    } catch (error) {
      if (
        timeout.aborted ||
        (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
      )
        fail('timeout', true);
      fail('other', true);
    }
    if (response.status === 429) fail('rate-limit', true, true);
    if (response.status >= 500) fail('server-error', true, true);
    if (!response.ok) fail('other', true, true);
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      fail('other', true, true);
    }
    try {
      return normalize(registration.kind, body, request.model);
    } catch {
      fail('other', true, true);
    }
  };
}
