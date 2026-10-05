import { type CacheControl, snapshotCacheControl } from './chat-parameters.ts';

export interface FunctionTool {
  readonly type: 'function';
  readonly cache_control?: CacheControl;
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
      const length = value.length;
      if (!Number.isSafeInteger(length) || length < 0 || length > budget.left)
        throw new TypeError('Invalid function tool');
      const parts: unknown[] = [];
      for (let index = 0; index < length; index++) {
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
  if (!Array.isArray(value)) throw new TypeError('Invalid function tools');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > 20_000)
    throw new TypeError('Invalid function tools');
  const source: readonly unknown[] = value;
  const entries = Array.from({ length }, (_, index) => {
    if (!Object.hasOwn(source, index)) throw new TypeError('Invalid function tools');
    return source[index];
  });
  const budget = { left: 20_000 };
  return Object.freeze(
    entries.map((entry) => {
      const tool = record(entry);
      if (!tool) throw new TypeError('Invalid function tools');
      const { type, function: rawDefinition } = tool;
      const cacheControl = Object.hasOwn(tool, 'cache_control')
        ? snapshotCacheControl(tool.cache_control)
        : undefined;
      const definition = record(rawDefinition);
      if (!definition) throw new TypeError('Invalid function tools');
      const { name, description, parameters: rawParameters, strict } = definition;
      if (
        !keys(tool, ['type', 'function', 'cache_control']) ||
        type !== 'function' ||
        !keys(definition, ['name', 'description', 'parameters', 'strict']) ||
        typeof name !== 'string' ||
        name.length === 0 ||
        name.length > 64 ||
        (description !== undefined && typeof description !== 'string') ||
        (strict !== undefined && strict !== null && typeof strict !== 'boolean') ||
        (rawParameters !== undefined && !record(rawParameters))
      )
        throw new TypeError('Invalid function tools');
      const parameters =
        rawParameters === undefined
          ? undefined
          : (json(rawParameters, 0, new Set(), budget) as Readonly<Record<string, unknown>>);
      return Object.freeze({
        type: 'function' as const,
        ...(cacheControl === undefined ? {} : { cache_control: cacheControl }),
        function: Object.freeze({
          name,
          ...(description === undefined ? {} : { description }),
          ...(parameters === undefined ? {} : { parameters }),
          ...(strict === undefined ? {} : { strict }),
        }),
      });
    }),
  );
}

export function snapshotToolChoice(value: unknown): ToolChoice | undefined {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'auto' || value === 'required') return value;
  const choice = record(value);
  if (!choice) throw new TypeError('Invalid tool choice');
  const { type, function: rawDefinition } = choice;
  const definition = record(rawDefinition);
  if (!definition) throw new TypeError('Invalid tool choice');
  const name = definition.name;
  if (
    !keys(choice, ['type', 'function']) ||
    type !== 'function' ||
    !keys(definition, ['name']) ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 64
  )
    throw new TypeError('Invalid tool choice');
  return Object.freeze({ type: 'function', function: Object.freeze({ name }) });
}

export function snapshotParallelToolCalls(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new TypeError('Invalid parallel tool calls');
  return value;
}
