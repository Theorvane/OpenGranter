import { type ReasoningEffort, validReasoningEffort } from './chat-parameters.ts';

export interface ReasoningConfiguration {
  readonly effort?: ReasoningEffort | null;
  readonly summary?: 'auto' | 'concise' | 'detailed' | null;
}

/** Capture supported preferences and compare only already-captured effort aliases. */
export function snapshotReasoningConfiguration(
  value: unknown,
  shorthand?: ReasoningEffort,
): ReasoningConfiguration | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid reasoning configuration');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Invalid reasoning configuration');
  if (Object.keys(value).some((key) => key !== 'summary' && key !== 'effort'))
    throw new TypeError('Invalid reasoning configuration');
  const source = value as Record<string, unknown>;
  let effort: ReasoningEffort | null | undefined;
  if (Object.hasOwn(source, 'effort')) {
    const captured = source.effort;
    if (captured !== null && (captured === undefined || !validReasoningEffort(captured)))
      throw new TypeError('Invalid reasoning configuration');
    effort = captured;
    if (shorthand !== undefined && effort !== shorthand)
      throw new TypeError('Invalid reasoning configuration');
  }
  let summary: ReasoningConfiguration['summary'];
  if (Object.hasOwn(source, 'summary')) {
    const captured = source.summary;
    if (
      captured !== null &&
      captured !== 'auto' &&
      captured !== 'concise' &&
      captured !== 'detailed'
    )
      throw new TypeError('Invalid reasoning configuration');
    summary = captured;
  }
  return Object.freeze({
    ...(effort === undefined ? {} : { effort }),
    ...(summary === undefined ? {} : { summary }),
  });
}
