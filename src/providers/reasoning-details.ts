interface ReasoningMetadata {
  readonly id?: string | null;
  readonly index?: number;
  readonly format?: string | null;
}
export type ReasoningDetail = ReasoningMetadata &
  (
    | { readonly type: 'reasoning.summary'; readonly summary: string }
    | { readonly type: 'reasoning.encrypted'; readonly data: string }
    | {
        readonly type: 'reasoning.text';
        readonly text?: string | null;
        readonly signature?: string | null;
      }
  );

/** Validate the supported response subset without interpreting opaque payloads. */
export function snapshotReasoningDetails(value: unknown): readonly ReasoningDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: ReasoningDetail[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const captured = Object.fromEntries(Object.entries(entry)) as Record<string, unknown>;
    const type = captured.type;
    const payloadKeys =
      type === 'reasoning.summary'
        ? ['summary']
        : type === 'reasoning.encrypted'
          ? ['data']
          : type === 'reasoning.text'
            ? ['text', 'signature']
            : undefined;
    if (!payloadKeys) return undefined;
    const allowed = new Set(['type', 'id', 'index', 'format', ...payloadKeys]);
    if (Object.keys(captured).some((key) => !allowed.has(key))) return undefined;
    if (type === 'reasoning.summary' && typeof captured.summary !== 'string') return undefined;
    if (type === 'reasoning.encrypted' && typeof captured.data !== 'string') return undefined;
    for (const key of ['id', 'format', ...(type === 'reasoning.text' ? payloadKeys : [])]) {
      if (
        Object.hasOwn(captured, key) &&
        captured[key] !== null &&
        typeof captured[key] !== 'string'
      )
        return undefined;
    }
    if (Object.hasOwn(captured, 'index') && !Number.isSafeInteger(captured.index)) return undefined;
    result.push(Object.freeze(captured) as unknown as ReasoningDetail);
  }
  return Object.freeze(result);
}
