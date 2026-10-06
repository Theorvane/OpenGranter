import type { ChatMessage } from '../gateway/chat-messages.ts';
import { type InlineImagePart, snapshotInlineImagePart } from '../gateway/inline-image-parts.ts';
import { validatePromptCacheHistory } from '../gateway/prompt-cache-parts.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';

interface NativeImage {
  readonly mimeType: string;
  readonly data: string;
}
function invalid(): never {
  throw new DirectProviderFailure('other', false, false);
}

/** Validate the selected native subset before credentials; never fetch or transcode media. */
export function prepareNativeImages(
  messages: readonly ChatMessage[],
  kind: 'anthropic' | 'google',
): ReadonlyMap<InlineImagePart, NativeImage> {
  const images = new Map<InlineImagePart, NativeImage>();
  let count = 0;
  try {
    for (const message of messages) {
      if (typeof message.content === 'string' || message.content === null) continue;
      for (const part of message.content) {
        const type = part.type;
        if (type !== 'image_url') continue;
        if (message.role !== 'user' || ++count > 20) invalid();
        const captured = snapshotInlineImagePart(part, type);
        if (captured.image_url.detail !== undefined) invalid();
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/u.exec(
          captured.image_url.url,
        );
        const mimeType = match?.[1];
        const data = match?.[2];
        if (!mimeType || !data || (kind === 'google' && mimeType === 'image/gif')) invalid();
        images.set(part, Object.freeze({ mimeType, data }));
      }
    }
    if (count) validatePromptCacheHistory(undefined, messages);
  } catch {
    invalid();
  }
  return images;
}
