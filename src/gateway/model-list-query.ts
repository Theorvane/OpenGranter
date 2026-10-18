import { comparePriceDecimals } from './model-price-order.ts';

export type BenchmarkSort =
  | 'intelligence-high-to-low'
  | 'coding-high-to-low'
  | 'agentic-high-to-low'
  | 'design-arena-elo-high-to-low';
export type PriceSort = 'pricing-low-to-high' | 'pricing-high-to-low';
type ModelListSort = 'newest' | 'context-high-to-low' | BenchmarkSort | PriceSort;
const sortOrders: readonly ModelListSort[] = [
  'newest',
  'context-high-to-low',
  'intelligence-high-to-low',
  'coding-high-to-low',
  'agentic-high-to-low',
  'design-arena-elo-high-to-low',
  'pricing-low-to-high',
  'pricing-high-to-low',
];
function isSortOrder(value: string | null): value is ModelListSort {
  return sortOrders.some((sort) => sort === value);
}

export interface ModelListQuery {
  readonly offset: number;
  readonly limit?: number;
  readonly outputModalities?: readonly string[];
  readonly supportedParameters?: readonly string[];
  readonly minimumContextLength?: number;
  readonly inputModalities?: readonly string[];
  readonly searchText?: string;
  readonly sortOrder?: ModelListSort;
  readonly benchmarkRanges?: readonly BenchmarkRange[];
  readonly priceRanges?: readonly ModelPriceRange[];
}

export interface ModelPriceRange {
  readonly price: 'prompt' | 'completion';
  readonly minimum?: string;
  readonly maximum?: string;
}

const priceFields = [
  { price: 'prompt', minimum: 'min_price', maximum: 'max_price' },
  { price: 'completion', minimum: 'min_output_price', maximum: 'max_output_price' },
] as const;
const priceBoundNames = priceFields.flatMap((field) => [field.minimum, field.maximum]);

interface BenchmarkRange {
  readonly index: 'intelligence_index' | 'coding_index' | 'agentic_index';
  readonly minimum?: number;
  readonly maximum?: number;
}
const benchmarkIndices = ['intelligence_index', 'coding_index', 'agentic_index'] as const;
const benchmarkBoundNames = benchmarkIndices.flatMap((index) => [`min_${index}`, `max_${index}`]);

const outputModalities = [
  'text',
  'image',
  'embeddings',
  'audio',
  'video',
  'rerank',
  'decisions',
  'speech',
  'transcription',
  'all',
];

/** Paging selects within the already authorized catalog; it never selects routes. */
export function parseModelListQuery(url: URL, compatible: boolean): ModelListQuery | undefined {
  if (!url.search) return { offset: 0 };
  if (!compatible) return undefined;
  const params = url.searchParams;
  if (params.size === 0) return undefined;
  for (const [key, value] of params) {
    if (params.getAll(key).length !== 1) return undefined;
    if (key === 'output_modalities') {
      const selected = value.split(',');
      if (
        selected.length > 9 ||
        new Set(selected).size !== selected.length ||
        selected.some((item) => !outputModalities.includes(item)) ||
        (selected.includes('all') && selected.length !== 1)
      )
        return undefined;
    } else if (key === 'input_modalities') {
      if (value.length > 21) return undefined;
      const selected = value.split(',');
      if (
        selected.length > 4 ||
        new Set(selected).size !== selected.length ||
        selected.some((item) => !['text', 'image', 'audio', 'file'].includes(item))
      )
        return undefined;
    } else if (key === 'q') {
      if (!value || value !== value.trim() || value.length > 512) return undefined;
      const characters = Array.from(value);
      if (
        characters.length > 256 ||
        characters.some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || (code >= 127 && code <= 159);
        })
      )
        return undefined;
    } else if (priceBoundNames.some((name) => name === key) || benchmarkBoundNames.includes(key)) {
      if (
        value.length > 128 ||
        !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(value) ||
        !Number.isFinite(Number(value))
      )
        return undefined;
    } else if (key === 'sort') {
      if (!isSortOrder(value)) return undefined;
    } else if (key === 'supported_parameters') {
      if (value.length > 64 * 128 + 63) return undefined;
      const selected = value.split(',');
      if (
        selected.length > 64 ||
        new Set(selected).size !== selected.length ||
        selected.some((item) => !/^[a-z][a-z0-9_]{0,127}$/u.test(item))
      )
        return undefined;
    } else if (key === 'offset' || key === 'limit' || key === 'context') {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value)))
        return undefined;
      if (key === 'context' && Number(value) < 1) return undefined;
    } else return undefined;
  }
  const offset = Number(params.get('offset') ?? '0');
  const limit = Number(params.get('limit') ?? '500');
  if (offset < 0 || limit < 1 || limit > 1000) return undefined;
  const outputModality = params.get('output_modalities');
  const supportedParameter = params.get('supported_parameters');
  const context = params.get('context');
  const inputModality = params.get('input_modalities');
  const searchText = params.get('q');
  const sortOrder = params.get('sort');
  const benchmarkRanges: BenchmarkRange[] = [];
  const priceRanges: ModelPriceRange[] = [];
  for (const field of priceFields) {
    const minimum = params.get(field.minimum);
    const maximum = params.get(field.maximum);
    if (minimum === null && maximum === null) continue;
    if (minimum !== null && maximum !== null && comparePriceDecimals(minimum, maximum) > 0)
      return undefined;
    priceRanges.push(
      Object.freeze({
        price: field.price,
        ...(minimum === null ? {} : { minimum }),
        ...(maximum === null ? {} : { maximum }),
      }),
    );
  }
  for (const index of benchmarkIndices) {
    const min = params.get(`min_${index}`);
    const max = params.get(`max_${index}`);
    if (min === null && max === null) continue;
    const minimum = min === null ? undefined : Number(min);
    const maximum = max === null ? undefined : Number(max);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) return undefined;
    benchmarkRanges.push(
      Object.freeze({
        index,
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      }),
    );
  }
  return {
    offset,
    ...(params.has('offset') || params.has('limit') ? { limit } : {}),
    ...(outputModality === null
      ? {}
      : { outputModalities: Object.freeze(outputModality.split(',')) }),
    ...(supportedParameter === null
      ? {}
      : { supportedParameters: Object.freeze(supportedParameter.split(',')) }),
    ...(context === null ? {} : { minimumContextLength: Number(context) }),
    ...(inputModality === null ? {} : { inputModalities: Object.freeze(inputModality.split(',')) }),
    ...(searchText === null ? {} : { searchText }),
    ...(isSortOrder(sortOrder) ? { sortOrder } : {}),
    ...(benchmarkRanges.length === 0 ? {} : { benchmarkRanges: Object.freeze(benchmarkRanges) }),
    ...(priceRanges.length === 0 ? {} : { priceRanges: Object.freeze(priceRanges) }),
  };
}

export function parseModelCountQuery(url: URL): ModelListQuery | undefined {
  for (const key of url.searchParams.keys()) if (key !== 'output_modalities') return undefined;
  const query = parseModelListQuery(url, true);
  if (!query) return undefined;
  return { ...query, outputModalities: query.outputModalities ?? Object.freeze(['text']) };
}

/** Continuations retain only validated filters and a fixed relative destination. */
export function modelListContinuation(query: ModelListQuery, offset: number): string | null {
  if (query.limit === undefined) return null;
  const params = new URLSearchParams({ offset: String(offset), limit: String(query.limit) });
  if (query.outputModalities !== undefined)
    params.set('output_modalities', query.outputModalities.join(','));
  if (query.supportedParameters !== undefined)
    params.set('supported_parameters', query.supportedParameters.join(','));
  if (query.minimumContextLength !== undefined)
    params.set('context', String(query.minimumContextLength));
  if (query.inputModalities !== undefined)
    params.set('input_modalities', query.inputModalities.join(','));
  if (query.searchText !== undefined) params.set('q', query.searchText);
  if (query.sortOrder !== undefined) params.set('sort', query.sortOrder);
  for (const range of query.benchmarkRanges ?? []) {
    if (range.minimum !== undefined) params.set(`min_${range.index}`, String(range.minimum));
    if (range.maximum !== undefined) params.set(`max_${range.index}`, String(range.maximum));
  }
  for (const range of query.priceRanges ?? []) {
    const field = priceFields.find((field) => field.price === range.price);
    if (field === undefined) continue;
    if (range.minimum !== undefined) params.set(field.minimum, range.minimum);
    if (range.maximum !== undefined) params.set(field.maximum, range.maximum);
  }
  return `/api/v1/models?${params}`;
}
