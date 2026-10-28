/** Bounded delta-seconds only; HTTP dates require a separate clock/normalization contract. */
export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null || value.length > 16 || !/^[0-9]+$/u.test(value)) return undefined;
  const seconds = Number(value);
  return validRetryAfterSeconds(seconds) ? seconds : undefined;
}

export function validRetryAfterSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
