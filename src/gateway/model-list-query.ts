export interface ModelListQuery {
  readonly offset: number;
  readonly limit?: number;
  readonly outputModality?: string;
  readonly supportedParameter?: string;
  readonly minimumContextLength?: number;
}

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
      if (!outputModalities.includes(value)) return undefined;
    } else if (key === 'supported_parameters') {
      if (!/^[a-z][a-z0-9_]{0,127}$/u.test(value)) return undefined;
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
  return {
    offset,
    ...(params.has('offset') || params.has('limit') ? { limit } : {}),
    ...(outputModality === null ? {} : { outputModality }),
    ...(supportedParameter === null ? {} : { supportedParameter }),
    ...(context === null ? {} : { minimumContextLength: Number(context) }),
  };
}

/** Continuations retain only validated filters and a fixed relative destination. */
export function modelListContinuation(query: ModelListQuery, offset: number): string | null {
  if (query.limit === undefined) return null;
  const params = new URLSearchParams({ offset: String(offset), limit: String(query.limit) });
  if (query.outputModality !== undefined) params.set('output_modalities', query.outputModality);
  if (query.supportedParameter !== undefined)
    params.set('supported_parameters', query.supportedParameter);
  if (query.minimumContextLength !== undefined)
    params.set('context', String(query.minimumContextLength));
  return `/api/v1/models?${params}`;
}
