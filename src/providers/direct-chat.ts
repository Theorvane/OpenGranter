import type { ChatRequest } from '../gateway/chat-handler.ts';
import {
  resolveOutputTokenLimit,
  snapshotStopSequences,
  validTemperature,
  validTopP,
} from '../gateway/chat-parameters.ts';
import type { RouteCandidate } from '../routing/authorize-candidates.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import { normalizeProviderUsage } from '../usage/normalize-provider-tokens.ts';

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
      readonly message: { readonly role: 'assistant'; readonly content: string };
      readonly finish_reason: 'stop' | 'length' | null;
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
  finish: 'stop' | 'length' | null,
  stats?: ChatCompletion['usage'],
): ChatCompletion {
  if (typeof content !== 'string') fail('other');
  return {
    id: typeof id === 'string' && id ? id : `direct-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: count(created) ?? Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }],
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
    const message = record(first.message);
    if (message?.role !== 'assistant') fail('other');
    const finish =
      first?.finish_reason === 'stop'
        ? 'stop'
        : first?.finish_reason === 'length'
          ? 'length'
          : null;
    return completion(
      value.id,
      value.created,
      model,
      message.content,
      finish,
      normalizeProviderUsage(value.usage),
    );
  }
  if (kind === 'anthropic') {
    const blocks = items(value.content);
    if (
      !blocks ||
      blocks.length === 0 ||
      blocks.some(
        (block) => record(block)?.type !== 'text' || typeof record(block)?.text !== 'string',
      )
    )
      fail('other');
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
  const candidates = items(value.candidates);
  const first = record(candidates?.[0]);
  if (candidates?.length !== 1 || !first || (first.index !== undefined && first.index !== 0))
    fail('other');
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
    normalizeProviderUsage(value.usageMetadata, [
      'promptTokenCount',
      'candidatesTokenCount',
      'totalTokenCount',
    ]),
  );
}

function prepare(
  registration: DirectProviderRegistration,
  candidate: RouteCandidate,
  request: ChatRequest,
  key: string,
  maxTokens: number | undefined,
  stop: ReturnType<typeof snapshotStopSequences>,
  temperature: number | undefined,
  topP: number | undefined,
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
        messages: request.messages,
        stream: false,
        ...(outputLimit === undefined ? {} : { max_tokens: outputLimit }),
        ...(temperature === undefined ? {} : { temperature }),
        ...(topP === undefined ? {} : { top_p: topP }),
        ...(stop === undefined ? {} : { stop }),
      },
    };
  }
  const system = request.messages.filter((message) => message.role === 'system');
  const messages = request.messages.filter((message) => message.role !== 'system');
  if (
    messages.length === 0 ||
    request.messages.slice(system.length).some((message) => message.role === 'system')
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
      topP === undefined
        ? {}
        : {
            generationConfig: {
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
    const topP = request.top_p;
    if (!validTopP(topP)) fail('other');
    const temperature = request.temperature;
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
      request,
      key,
      maxTokens,
      stop,
      temperature,
      topP,
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
