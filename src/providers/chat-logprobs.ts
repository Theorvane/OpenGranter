export interface ChatTokenAlternative {
  readonly token: string;
  readonly logprob: number;
  readonly bytes: readonly number[] | null;
}
export interface ChatTokenLogprob extends ChatTokenAlternative {
  readonly top_logprobs: readonly ChatTokenAlternative[];
}
export interface ChatLogprobs {
  readonly content: readonly ChatTokenLogprob[] | null;
  readonly refusal?: readonly ChatTokenLogprob[] | null;
}

function invalid(): never {
  throw new Error('Unsupported chat token probabilities');
}
function capture(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = Object.fromEntries(Object.entries(value));
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid();
  return result;
}
function list(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) invalid();
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) invalid();
  return Object.freeze(Array.from({ length }, (_, index) => value[index]));
}

/** Preserve choice-level content/refusal probabilities, never accounting or logging them. */
export function snapshotChatLogprobs(value: unknown): ChatLogprobs | null | undefined {
  if (value === undefined || value === null) return value;
  let tokens = 0;
  let units = 0;
  const scalar = (entry: Record<string, unknown>): ChatTokenAlternative => {
    const { token, logprob, bytes } = entry;
    if (
      typeof token !== 'string' ||
      token.length > 16384 ||
      typeof logprob !== 'number' ||
      !Number.isFinite(logprob)
    )
      invalid();
    const byteArray =
      bytes === null
        ? null
        : Object.freeze(
            Array.from(list(bytes, 1024), (byte) => {
              if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255)
                invalid();
              return byte;
            }),
          );
    units += token.length + (byteArray?.length ?? 0);
    if (units > 1048576) invalid();
    return { token, logprob, bytes: byteArray };
  };
  const group = (input: unknown): readonly ChatTokenLogprob[] | null => {
    if (input === null) return null;
    const entries = list(input, 65536);
    tokens += entries.length;
    if (tokens > 65536) invalid();
    return Object.freeze(
      Array.from(entries, (item) => {
        const entry = capture(item, ['token', 'logprob', 'bytes', 'top_logprobs']);
        const fields = scalar(entry);
        const alternatives = Object.freeze(
          Array.from(list(entry.top_logprobs, 20), (alternative) =>
            Object.freeze(scalar(capture(alternative, ['token', 'logprob', 'bytes']))),
          ),
        );
        return Object.freeze({ ...fields, top_logprobs: alternatives });
      }),
    );
  };
  const captured = capture(value, ['content', 'refusal']);
  const content = group(captured.content);
  return Object.freeze({
    content,
    ...(Object.hasOwn(captured, 'refusal') ? { refusal: group(captured.refusal) } : {}),
  });
}
