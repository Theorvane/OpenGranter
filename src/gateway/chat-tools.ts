export interface FunctionTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    readonly strict?: boolean | null;
  };
}

export type ToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { readonly type: 'function'; readonly function: { readonly name: string } };

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : undefined;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function json(value: unknown, depth: number, seen: Set<object>, budget: { left: number }): unknown {
  if (--budget.left < 0 || depth > 64) throw new TypeError('Invalid function tool');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('Invalid function tool');
  if (seen.has(value)) throw new TypeError('Invalid function tool');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > budget.left) throw new TypeError('Invalid function tool');
      const parts: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, index);
        if (!property || !('value' in property)) throw new TypeError('Invalid function tool');
        parts.push(json(property.value, depth + 1, seen, budget));
      }
      return Object.freeze(parts);
    }
    const source = record(value);
    if (!source) throw new TypeError('Invalid function tool');
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(source)) {
      const property = Object.getOwnPropertyDescriptor(source, key);
      if (!property || !('value' in property)) throw new TypeError('Invalid function tool');
      result[key] = json(property.value, depth + 1, seen, budget);
    }
    return Object.freeze(result);
  } finally {
    seen.delete(value);
  }
}

/** Capture a bounded plain JSON object without reading accessor properties. */
export function snapshotBoundedJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!record(value)) throw new TypeError('Invalid JSON object');
  return json(value, 0, new Set(), { left: 20_000 }) as Readonly<Record<string, unknown>>;
}

export function snapshotFunctionTools(value: unknown): readonly FunctionTool[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20_000) throw new TypeError('Invalid function tools');
  const budget = { left: 20_000 };
  return Object.freeze(
    Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(value, index)) throw new TypeError('Invalid function tools');
      const entry = value[index];
      const tool = record(entry);
      const definition = record(tool?.function);
      if (
        !tool ||
        !keys(tool, ['type', 'function']) ||
        tool.type !== 'function' ||
        !definition ||
        !keys(definition, ['name', 'description', 'parameters', 'strict']) ||
        typeof definition.name !== 'string' ||
        definition.name.length === 0 ||
        definition.name.length > 64 ||
        (definition.description !== undefined && typeof definition.description !== 'string') ||
        (definition.strict !== undefined &&
          definition.strict !== null &&
          typeof definition.strict !== 'boolean') ||
        (definition.parameters !== undefined && !record(definition.parameters))
      )
        throw new TypeError('Invalid function tools');
      const parameters =
        definition.parameters === undefined
          ? undefined
          : (json(definition.parameters, 0, new Set(), budget) as Readonly<
              Record<string, unknown>
            >);
      return Object.freeze({
        type: 'function' as const,
        function: Object.freeze({
          name: definition.name,
          ...(definition.description === undefined ? {} : { description: definition.description }),
          ...(parameters === undefined ? {} : { parameters }),
          ...(definition.strict === undefined ? {} : { strict: definition.strict }),
        }),
      });
    }),
  );
}

export function snapshotToolChoice(value: unknown): ToolChoice | undefined {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'auto' || value === 'required') return value;
  const choice = record(value);
  const definition = record(choice?.function);
  if (
    !choice ||
    !keys(choice, ['type', 'function']) ||
    choice.type !== 'function' ||
    !definition ||
    !keys(definition, ['name']) ||
    typeof definition.name !== 'string' ||
    definition.name.length === 0 ||
    definition.name.length > 64
  )
    throw new TypeError('Invalid tool choice');
  return Object.freeze({ type: 'function', function: Object.freeze({ name: definition.name }) });
}

export function snapshotParallelToolCalls(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new TypeError('Invalid parallel tool calls');
  return value;
}
