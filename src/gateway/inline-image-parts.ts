export interface InlineImagePart {
  readonly type: 'image_url';
  readonly image_url: { readonly url: string; readonly detail?: 'auto' | 'low' | 'high' };
  readonly text?: never;
  readonly cache_control?: never;
  readonly prompt_cache_breakpoint?: never;
}
export const MAX_INLINE_IMAGE_URL_UNITS = 524_288;
export const MAX_INLINE_IMAGE_HISTORY_UNITS = 786_432;
function plain(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid image content');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('Invalid image content');
  return value as Record<string, unknown>;
}
/** Capture the image fields once; never fetch, decode pixels or normalize caller data. */
export function snapshotInlineImagePart(value: unknown, capturedType?: unknown): InlineImagePart {
  const part = plain(value);
  const type = capturedType === undefined ? part.type : capturedType;
  if (
    type !== 'image_url' ||
    !Object.hasOwn(part, 'type') ||
    !Object.hasOwn(part, 'image_url') ||
    Object.keys(part).some((key) => key !== 'type' && key !== 'image_url')
  )
    throw new TypeError('Invalid image content');
  const image = plain(part.image_url);
  const url = image.url;
  const detail = Object.hasOwn(image, 'detail') ? image.detail : undefined;
  if (
    !Object.hasOwn(image, 'url') ||
    Object.keys(image).some((key) => key !== 'url' && key !== 'detail') ||
    typeof url !== 'string' ||
    url.length > MAX_INLINE_IMAGE_URL_UNITS ||
    (Object.hasOwn(image, 'detail') && detail === undefined) ||
    (detail !== undefined && detail !== 'auto' && detail !== 'low' && detail !== 'high')
  )
    throw new TypeError('Invalid image content');
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(url);
  const payload = match?.[1];
  if (
    !payload ||
    payload.length % 4 !== 0 ||
    Buffer.from(payload, 'base64').toString('base64') !== payload
  )
    throw new TypeError('Invalid image content');
  return Object.freeze({
    type: 'image_url',
    image_url: Object.freeze({ url, ...(detail === undefined ? {} : { detail }) }),
  });
}
export function hasInlineImages(
  messages: readonly { readonly content: string | null | readonly { readonly type: string }[] }[],
): boolean {
  return messages.some(
    ({ content }) => Array.isArray(content) && content.some((part) => part.type === 'image_url'),
  );
}
