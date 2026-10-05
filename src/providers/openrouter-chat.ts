import type { ChatRequest } from '../gateway/chat-handler.ts';
import { type ChatMessage, snapshotChatMessages } from '../gateway/chat-messages.ts';
import {
  resolveOutputTokenLimit,
  snapshotCacheControl,
  snapshotClientMetadata,
  snapshotClientUser,
  snapshotLogitBias,
  snapshotLogprobControls,
  snapshotPrediction,
  snapshotPromptCacheKey,
  snapshotPromptCacheOptions,
  snapshotResponseFormat,
  snapshotStopSequences,
  snapshotStreamOptions,
  snapshotTextModalities,
  validateCacheOptionsControls,
  validatePredictionControls,
  validMinP,
  validPenalty,
  validReasoningEffort,
  validRepetitionPenalty,
  validSeed,
  validSingleChoice,
  validTemperature,
  validTopA,
  validTopK,
  validTopP,
  validVerbosity,
} from '../gateway/chat-parameters.ts';
import {
  snapshotFunctionTools,
  snapshotParallelToolCalls,
  snapshotToolChoice,
} from '../gateway/chat-tools.ts';
import { validatePromptCacheHistory } from '../gateway/prompt-cache-parts.ts';
import { snapshotReasoningConfiguration } from '../gateway/reasoning-configuration.ts';
import { waitForStreamOperation } from '../streaming/wait-for-stream-operation.ts';
import { normalizeAssistantResponse } from './assistant-response.ts';
import { snapshotChatLogprobs } from './chat-logprobs.ts';
import { normalizeChatUsage } from './chat-usage.ts';
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

/** Capture the IAM-approved destination before credential or transport awaits. */
export function snapshotOpenRouterChatAttempt(value: OpenRouterChatAttempt): OpenRouterChatAttempt {
  let snapshot: OpenRouterChatAttempt;
  try {
    snapshot = {
      upstreamModelId: value.upstreamModelId,
      authorizedProviderSlugs: [...value.authorizedProviderSlugs],
    };
  } catch {
    fail('configuration');
  }
  if (!validAttempt(snapshot)) fail('configuration');
  return Object.freeze({
    upstreamModelId: snapshot.upstreamModelId,
    authorizedProviderSlugs: Object.freeze(snapshot.authorizedProviderSlugs),
  });
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
  clientModelAlias: string,
  attempt: OpenRouterChatAttempt,
): ChatCompletion {
  const value = record(body);
  const fingerprint = value?.system_fingerprint;
  const serviceTier = value?.service_tier;
  const choices = Array.isArray(value?.choices) ? value.choices : undefined;
  const first = record(choices?.[0]);
  const nativeReason = first?.native_finish_reason;
  const message = normalizeAssistantResponse(record(first?.message), first?.finish_reason);
  if (
    choices?.length !== 1 ||
    typeof value?.id !== 'string' ||
    !value.id ||
    count(value.created) === undefined ||
    value.model !== attempt.upstreamModelId ||
    first?.index !== 0 ||
    !message ||
    (fingerprint !== undefined && fingerprint !== null && typeof fingerprint !== 'string') ||
    (serviceTier !== undefined && serviceTier !== null && typeof serviceTier !== 'string') ||
    (nativeReason !== undefined && nativeReason !== null && typeof nativeReason !== 'string')
  )
    fail('upstream', true, true);

  const stats = normalizeChatUsage(value.usage);
  const logprobs = snapshotChatLogprobs(first.logprobs);
  const finish = first.finish_reason;
  if (
    finish !== 'stop' &&
    finish !== 'length' &&
    finish !== 'content_filter' &&
    finish !== 'tool_calls' &&
    finish !== null
  )
    fail('upstream', true, true);
  return {
    id: value.id,
    object: 'chat.completion',
    created: value.created as number,
    model: clientModelAlias,
    ...(fingerprint === undefined ? {} : { system_fingerprint: fingerprint }),
    ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
    choices: [
      {
        index: 0,
        message,
        finish_reason: finish,
        ...(nativeReason === undefined ? {} : { native_finish_reason: nativeReason }),
        ...(logprobs === undefined ? {} : { logprobs }),
      },
    ],
    ...(stats ? { usage: stats } : {}),
  };
}

interface PreparedOpenRouterChatRequest {
  readonly attempt: OpenRouterChatAttempt;
  readonly clientModelAlias: string;
  readonly credentialRef: string;
  readonly timeoutMs: number;
  readonly body: Readonly<Record<string, unknown>>;
}

/** Snapshot one authorized delegated request before credential or transport awaits. */
function prepareOpenRouterChatRequest(
  ports: OpenRouterChatPorts,
  attempt: OpenRouterChatAttempt,
  request: ChatRequest,
  stream: boolean,
  functionStream = false,
): PreparedOpenRouterChatRequest {
  const fixedAttempt = snapshotOpenRouterChatAttempt(attempt);
  const topK = request.top_k ?? undefined;
  if (!validTopK(topK)) fail('configuration');

  const verbosity = request.verbosity ?? undefined;
  if (!validVerbosity(verbosity)) fail('configuration');
  const reasoningEffort = request.reasoning_effort ?? undefined;
  if (!validReasoningEffort(reasoningEffort)) fail('configuration');
  const seed = request.seed ?? undefined;
  if (!validSeed(seed)) fail('configuration');
  const frequencyPenalty = request.frequency_penalty ?? undefined;
  const presencePenalty = request.presence_penalty ?? undefined;
  if (!validPenalty(frequencyPenalty) || !validPenalty(presencePenalty)) fail('configuration');
  let reasoning: ReturnType<typeof snapshotReasoningConfiguration>;
  let prediction: ReturnType<typeof snapshotPrediction>;
  let modalities: ReturnType<typeof snapshotTextModalities>;
  let cacheOptions: ReturnType<typeof snapshotPromptCacheOptions>;
  let cacheControl: ReturnType<typeof snapshotCacheControl>;
  let metadata: ReturnType<typeof snapshotClientMetadata>;
  let user: ReturnType<typeof snapshotClientUser>;
  let promptCacheKey: ReturnType<typeof snapshotPromptCacheKey>;
  let responseFormat: ReturnType<typeof snapshotResponseFormat>;
  try {
    prediction = snapshotPrediction(request.prediction);
    modalities = snapshotTextModalities(request.modalities);
    cacheOptions = snapshotPromptCacheOptions(request.prompt_cache_options);
    cacheControl = snapshotCacheControl(request.cache_control);
    validateCacheOptionsControls(cacheOptions, cacheControl);
    metadata = snapshotClientMetadata(request.metadata);
    user = snapshotClientUser(request.user);
    promptCacheKey = snapshotPromptCacheKey(request.prompt_cache_key);
    reasoning = snapshotReasoningConfiguration(
      request.reasoning,
      reasoningEffort,
      request.include_reasoning,
    );
    responseFormat = snapshotResponseFormat(request.response_format);
  } catch {
    fail('configuration');
  }
  let logitBias: ReturnType<typeof snapshotLogitBias>;
  let logprobControls: ReturnType<typeof snapshotLogprobControls>;
  let streamOptions: ReturnType<typeof snapshotStreamOptions>;
  let tools: ReturnType<typeof snapshotFunctionTools>;
  let toolChoice: ReturnType<typeof snapshotToolChoice>;
  let parallelToolCalls: ReturnType<typeof snapshotParallelToolCalls>;
  try {
    logprobControls = snapshotLogprobControls(request.logprobs, request.top_logprobs);
    streamOptions = snapshotStreamOptions(request.stream_options);
    if (streamOptions !== undefined && !stream) fail('configuration');
    logitBias = snapshotLogitBias(request.logit_bias);
    if (
      stream &&
      !functionStream &&
      (request.tools !== undefined ||
        request.tool_choice !== undefined ||
        request.parallel_tool_calls !== undefined)
    )
      fail('configuration');
    tools = snapshotFunctionTools(request.tools);
    toolChoice = snapshotToolChoice(request.tool_choice);
    parallelToolCalls = snapshotParallelToolCalls(request.parallel_tool_calls);
  } catch {
    fail('configuration');
  }
  const n = request.n;
  if (!validSingleChoice(n)) fail('configuration');
  const minP = request.min_p ?? undefined;
  if (!validMinP(minP)) fail('configuration');
  const topA = request.top_a ?? undefined;
  if (!validTopA(topA)) fail('configuration');
  const repetitionPenalty = request.repetition_penalty ?? undefined;
  if (!validRepetitionPenalty(repetitionPenalty)) fail('configuration');
  const topP = request.top_p ?? undefined;
  if (!validTopP(topP)) fail('configuration');
  const temperature = request.temperature ?? undefined;
  if (!validTemperature(temperature)) fail('configuration');
  let maxTokens: number | undefined;
  let maxCompletionTokens: unknown;
  try {
    maxCompletionTokens = request.max_completion_tokens;
    maxTokens = resolveOutputTokenLimit(request.max_tokens, maxCompletionTokens);
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
    !ports.credentialRef ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  )
    fail('configuration');
  let messages: readonly ChatMessage[];
  try {
    messages = snapshotChatMessages(request.messages);
    validatePromptCacheHistory(cacheControl, messages);
    validatePredictionControls(prediction, {
      tools,
      toolChoice,
      parallelToolCalls,
      logprobControls,
      frequencyPenalty,
      presencePenalty,
      maxCompletionTokens,
      hasFunctionHistory: messages.some(
        (message) => message.role === 'tool' || message.tool_calls !== undefined,
      ),
    });
    if (
      messages.some((message) =>
        message.tool_calls?.some((call) => call.extra_content !== undefined),
      )
    )
      fail('configuration');
  } catch {
    fail('configuration');
  }
  return Object.freeze({
    attempt: fixedAttempt,
    clientModelAlias: request.model,
    credentialRef: ports.credentialRef,
    timeoutMs,
    body: Object.freeze({
      model: fixedAttempt.upstreamModelId,
      ...(prediction === undefined ? {} : { prediction }),
      ...(modalities === undefined ? {} : { modalities }),
      ...(cacheOptions === undefined ? {} : { prompt_cache_options: cacheOptions }),
      ...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(user === undefined ? {} : { user }),
      ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
      messages,
      stream,
      ...(streamOptions === undefined ? {} : { stream_options: streamOptions }),
      ...(n === undefined ? {} : { n }),
      ...(seed === undefined ? {} : { seed }),
      ...(verbosity === undefined ? {} : { verbosity }),
      ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(frequencyPenalty === undefined ? {} : { frequency_penalty: frequencyPenalty }),
      ...(presencePenalty === undefined ? {} : { presence_penalty: presencePenalty }),
      ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
      ...(logitBias === undefined ? {} : { logit_bias: logitBias }),
      ...logprobControls,
      ...(tools === undefined ? {} : { tools }),
      ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
      ...(parallelToolCalls === undefined ? {} : { parallel_tool_calls: parallelToolCalls }),
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { top_p: topP }),
      ...(repetitionPenalty === undefined ? {} : { repetition_penalty: repetitionPenalty }),
      ...(topA === undefined ? {} : { top_a: topA }),
      ...(minP === undefined ? {} : { min_p: minP }),
      ...(topK === undefined ? {} : { top_k: topK }),
      ...(stop === undefined ? {} : { stop }),
      provider: Object.freeze({ only: fixedAttempt.authorizedProviderSlugs }),
    }),
  });
}

/** Send a prepared request to the fixed OpenRouter endpoint. */
async function fetchOpenRouterChatResponse(
  ports: OpenRouterChatPorts,
  prepared: PreparedOpenRouterChatRequest,
  cancellation?: AbortSignal,
): Promise<{
  readonly response: Response;
  readonly timeout: AbortSignal;
  readonly signal: AbortSignal;
}> {
  if (cancellation?.aborted) fail('upstream');
  let key: string | undefined;
  try {
    key = await waitForStreamOperation(ports.resolveSecret(prepared.credentialRef), cancellation);
  } catch {
    if (cancellation?.aborted) fail('upstream');
    fail('credential');
  }
  if (cancellation?.aborted) fail('upstream');
  if (!key) fail('credential');

  const timeout = AbortSignal.timeout(prepared.timeoutMs);
  const signal = cancellation ? AbortSignal.any([cancellation, timeout]) : timeout;
  let response: Response;
  try {
    response = await waitForStreamOperation(
      (ports.fetcher ?? fetch)(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(prepared.body),
        redirect: 'error',
        signal,
      }),
      signal,
      (lateResponse) => {
        void lateResponse.body?.cancel().catch(() => {});
      },
    );
  } catch (error) {
    if (cancellation?.aborted && !timeout.aborted) fail('upstream', false, true);
    if (
      timeout.aborted ||
      (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
    ) {
      fail('timeout', false, true);
    }
    fail('upstream', false, true);
  }
  return { response, timeout, signal };
}

/** Keep preparation and transport inside one validated adapter boundary. */
export async function invokeOpenRouterChatTransport(
  ports: OpenRouterChatPorts,
  attempt: OpenRouterChatAttempt,
  request: ChatRequest,
  stream: boolean,
  cancellation?: AbortSignal,
): Promise<{
  readonly prepared: PreparedOpenRouterChatRequest;
  readonly response: Response;
  readonly timeout: AbortSignal;
  readonly signal: AbortSignal;
}> {
  const prepared = prepareOpenRouterChatRequest(ports, attempt, request, stream);
  const { response, timeout, signal } = await fetchOpenRouterChatResponse(
    ports,
    prepared,
    cancellation,
  );
  return { prepared, response, timeout, signal };
}

/** Explicit internal function-stream capability; text guards remain separate. */
export async function invokeOpenRouterFunctionStreamTransport(
  ports: OpenRouterChatPorts,
  attempt: OpenRouterChatAttempt,
  request: ChatRequest,
  cancellation?: AbortSignal,
): Promise<{
  readonly prepared: PreparedOpenRouterChatRequest;
  readonly response: Response;
  readonly timeout: AbortSignal;
  readonly signal: AbortSignal;
}> {
  const prepared = prepareOpenRouterChatRequest(ports, attempt, request, true, true);
  const { response, timeout, signal } = await fetchOpenRouterChatResponse(
    ports,
    prepared,
    cancellation,
  );
  return { prepared, response, timeout, signal };
}

/** Invoke one previously authorized delegated route without forwarding caller routing controls. */
export function createOpenRouterChatInvoker(
  ports: OpenRouterChatPorts,
): (attempt: OpenRouterChatAttempt, request: ChatRequest) => Promise<ChatCompletion> {
  return async (attempt, request) => {
    const { prepared, response } = await invokeOpenRouterChatTransport(
      ports,
      attempt,
      request,
      false,
    );
    if (response.status === 429) fail('rate-limit', true, true);
    if (response.status >= 500) fail('server-error', true, true);
    if (!response.ok) fail('upstream', true, true);
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
      return normalize(body, prepared.clientModelAlias, prepared.attempt);
    } catch {
      fail('upstream', true, true);
    }
  };
}
