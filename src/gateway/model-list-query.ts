export interface ModelListQuery {
  readonly offset: number;
  readonly limit?: number;
}

/** Paging selects within the already authorized catalog; it never selects routes. */
export function parseModelListQuery(url: URL, compatible: boolean): ModelListQuery | undefined {
  if (!url.search) return { offset: 0 };
  if (!compatible) return undefined;
  const params = url.searchParams;
  if (params.size === 0) return undefined;
  for (const [key, value] of params) {
    if (
      (key !== 'offset' && key !== 'limit') ||
      params.getAll(key).length !== 1 ||
      !/^(?:0|[1-9][0-9]*)$/u.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      return undefined;
  }
  const offset = Number(params.get('offset') ?? '0');
  const limit = Number(params.get('limit') ?? '500');
  if (offset < 0 || limit < 1 || limit > 1000) return undefined;
  return { offset, limit };
}
