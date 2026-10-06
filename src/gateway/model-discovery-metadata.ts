/** Administrator-published informational metadata; never routing authority or billed cost. */
export interface OpenRouterModelMetadata {
  readonly canonical_slug: string;
  readonly name: string;
  readonly description?: string;
  readonly expiration_date?: string | null;
  readonly knowledge_cutoff?: string | null;
  readonly context_length: number | null;
  readonly architecture: {
    readonly modality: string | null;
    readonly input_modalities: readonly string[];
    readonly output_modalities: readonly string[];
  };
  readonly pricing: Readonly<Record<string, string>>;
  readonly top_provider: {
    readonly is_moderated: boolean;
    readonly context_length?: number | null;
    readonly max_completion_tokens?: number | null;
  };
  readonly supported_parameters: readonly string[];
  readonly supported_voices: readonly string[] | null;
  readonly default_parameters: Readonly<Record<string, number | null>> | null;
  readonly per_request_limits: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  } | null;
  readonly links: { readonly details: string };
}
const fields = [
  'canonical_slug',
  'name',
  'description',
  'expiration_date',
  'knowledge_cutoff',
  'context_length',
  'architecture',
  'pricing',
  'top_provider',
  'supported_parameters',
  'supported_voices',
  'default_parameters',
  'per_request_limits',
  'links',
] as const;
const priceFields = [
  'prompt',
  'completion',
  'request',
  'image',
  'image_output',
  'image_token',
  'audio',
  'audio_output',
  'input_audio_cache',
  'input_cache_read',
  'input_cache_write',
  'input_cache_write_1h',
  'internal_reasoning',
  'web_search',
] as const;
const defaultFields = [
  'temperature',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
] as const;
function invalid(): never {
  throw new Error('Invalid model discovery metadata');
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) invalid();
  return value;
}
function descriptiveText(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) invalid();
  return value;
}
function descriptiveDate(value: unknown): string | null {
  return value === null ? null : descriptiveText(value, 256);
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) invalid();
  const result: string[] = [];
  // Capture once; iteration rejects holes rather than serializing them as null.
  for (const entry of value) result.push(text(entry, 128));
  if (new Set(result).size !== result.length) invalid();
  return Object.freeze(result);
}
function tokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function nullableTokens(value: unknown): number | null {
  return value === null ? null : tokens(value);
}
function prices(value: unknown): Readonly<Record<string, string>> {
  const source = object(value, priceFields);
  if (!Object.hasOwn(source, 'prompt') || !Object.hasOwn(source, 'completion')) invalid();
  const result: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    const price = text(source[key], 128);
    if (
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(price) ||
      !Number.isFinite(Number(price))
    )
      invalid();
    result[key] = price;
  }
  return Object.freeze(result);
}
function defaults(value: unknown): Readonly<Record<string, number | null>> | null {
  if (value === null) return null;
  const source = object(value, defaultFields);
  const result: Record<string, number | null> = {};
  for (const key of Object.keys(source)) {
    const number = source[key];
    if (
      number !== null &&
      (typeof number !== 'number' ||
        !Number.isFinite(number) ||
        (key === 'top_k' && !Number.isSafeInteger(number)))
    )
      invalid();
    result[key] = number as number | null;
  }
  return Object.freeze(result);
}
/** Capture a bounded known-field snapshot before audit/database handoffs. */
export function snapshotOpenRouterMetadata(value: unknown): OpenRouterModelMetadata {
  try {
    const source = object(value, fields);
    const architecture = object(source.architecture, [
      'modality',
      'input_modalities',
      'output_modalities',
    ]);
    const top = object(source.top_provider, [
      'is_moderated',
      'context_length',
      'max_completion_tokens',
    ]);
    const isModerated = top.is_moderated;
    if (typeof isModerated !== 'boolean') invalid();
    const modality = architecture.modality;
    const supportedVoices = source.supported_voices;
    const perRequestLimits = source.per_request_limits;
    const links = object(source.links, ['details']);
    const details = text(links.details, 2048);
    const url = new URL(details);
    if (url.protocol !== 'https:' || url.username || url.password) invalid();
    const limits =
      perRequestLimits === null
        ? null
        : object(perRequestLimits, ['prompt_tokens', 'completion_tokens']);
    return Object.freeze({
      canonical_slug: text(source.canonical_slug),
      name: text(source.name),
      ...(Object.hasOwn(source, 'description')
        ? { description: descriptiveText(source.description, 8192) }
        : {}),
      ...(Object.hasOwn(source, 'expiration_date')
        ? { expiration_date: descriptiveDate(source.expiration_date) }
        : {}),
      ...(Object.hasOwn(source, 'knowledge_cutoff')
        ? { knowledge_cutoff: descriptiveDate(source.knowledge_cutoff) }
        : {}),
      context_length: nullableTokens(source.context_length),
      architecture: Object.freeze({
        modality: modality === null ? null : text(modality, 128),
        input_modalities: strings(architecture.input_modalities),
        output_modalities: strings(architecture.output_modalities),
      }),
      pricing: prices(source.pricing),
      top_provider: Object.freeze({
        is_moderated: isModerated,
        ...(Object.hasOwn(top, 'context_length')
          ? { context_length: nullableTokens(top.context_length) }
          : {}),
        ...(Object.hasOwn(top, 'max_completion_tokens')
          ? { max_completion_tokens: nullableTokens(top.max_completion_tokens) }
          : {}),
      }),
      supported_parameters: strings(source.supported_parameters),
      supported_voices: supportedVoices === null ? null : strings(supportedVoices),
      default_parameters: defaults(source.default_parameters),
      per_request_limits:
        limits === null
          ? null
          : Object.freeze({
              prompt_tokens: tokens(limits.prompt_tokens),
              completion_tokens: tokens(limits.completion_tokens),
            }),
      links: Object.freeze({ details }),
    });
  } catch {
    return invalid();
  }
}
