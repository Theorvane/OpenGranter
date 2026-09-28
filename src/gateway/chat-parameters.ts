/** Optional client output maximum; supplied values must be positive safe integers. */
export function validOutputTokenLimit(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  );
}
