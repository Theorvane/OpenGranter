export interface GoogleThoughtSignatureContent {
  readonly google: { readonly thought_signature: string };
}
export const MAX_GOOGLE_SIGNATURE_UNITS = 1_048_576;
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Preserve an opaque native representation; this validates shape, never authenticity. */
export function snapshotGoogleThoughtSignature(value: unknown): GoogleThoughtSignatureContent {
  const extra = record(value),
    google = record(extra?.google);
  const signature = google?.thought_signature;
  if (
    !extra ||
    !google ||
    Object.keys(extra).length !== 1 ||
    Object.keys(google).length !== 1 ||
    typeof signature !== 'string' ||
    !signature ||
    signature.length > MAX_GOOGLE_SIGNATURE_UNITS
  )
    throw new TypeError('Invalid function metadata');
  return Object.freeze({ google: Object.freeze({ thought_signature: signature }) });
}
