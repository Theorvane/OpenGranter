import {
  type ChatLogprobs,
  type ChatTokenAlternative,
  snapshotChatLogprobs,
} from './chat-logprobs.ts';

function invalid(): never {
  throw new Error('Unsupported Google token probabilities');
}
function capture(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = Object.fromEntries(Object.entries(value));
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid();
  return result;
}
function repeated(value: unknown, maximum: number): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid();
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) invalid();
  return Array.from({ length }, (_, index) => value[index]);
}

/** Preserve the candidate's reported sequence; native tokens have no byte data or part offsets. */
export function normalizeGoogleChatLogprobs(value: unknown): ChatLogprobs | undefined {
  if (value === undefined || value === null) return undefined;
  const result = capture(value, ['chosenCandidates', 'topCandidates', 'logProbabilitySum']);
  const sum = result.logProbabilitySum;
  if (sum !== undefined && sum !== null && (typeof sum !== 'number' || !Number.isFinite(sum)))
    invalid();
  const chosen = repeated(result.chosenCandidates, 65536);
  const top = repeated(result.topCandidates, 65536);
  if (top.length !== 0 && top.length !== chosen.length) invalid();
  let units = 0;
  const token = (input: unknown): ChatTokenAlternative => {
    const fields = capture(input, ['token', 'tokenId', 'logProbability']);
    const { token: text, tokenId, logProbability } = fields;
    if (
      typeof text !== 'string' ||
      text.length > 16384 ||
      typeof logProbability !== 'number' ||
      !Number.isFinite(logProbability) ||
      (tokenId !== undefined &&
        tokenId !== null &&
        (typeof tokenId !== 'number' ||
          !Number.isInteger(tokenId) ||
          tokenId < -2147483648 ||
          tokenId > 2147483647))
    )
      invalid();
    units += text.length;
    if (units > 1048576) invalid();
    return { token: text, logprob: logProbability, bytes: null };
  };
  const content = chosen.map((entry, index) => {
    const selected = token(entry);
    const alternatives =
      top.length === 0 ? [] : repeated(capture(top[index], ['candidates']).candidates, 20);
    return { ...selected, top_logprobs: alternatives.map(token) };
  });
  const snapshot = snapshotChatLogprobs({ content });
  if (!snapshot) invalid();
  return snapshot;
}
