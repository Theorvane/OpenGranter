import { chunk, frames } from './google-function-stream-fixture.ts';
import { imageFixture, inlineUrl } from './inline-image-inputs-fixture.ts';
import { probabilityFixture } from './nonstream-logprobs-fixture.ts';

export const nativeImageHistory = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'private image question Ω' },
      { type: 'image_url' as const, image_url: { url: inlineUrl } },
      { type: 'text' as const, text: '' },
    ],
  },
];
export const nativeSdkHistory = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'private image question Ω' },
      { type: 'image_url' as const, imageUrl: { url: inlineUrl } },
      { type: 'text' as const, text: '' },
    ],
  },
];
export const nativeBase64 = inlineUrl.split(',')[1];
export function nativeExpected(kind: 'anthropic' | 'google', mimeType = 'image/png') {
  return [
    {
      role: 'user',
      ...(kind === 'anthropic'
        ? {
            content: [
              { type: 'text', text: 'private image question Ω' },
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: nativeBase64 },
              },
              { type: 'text', text: '' },
            ],
          }
        : {
            parts: [
              { text: 'private image question Ω' },
              { inlineData: { mimeType, data: nativeBase64 } },
              { text: '' },
            ],
          }),
    },
  ];
}
export function nativeImageFixture(
  kind: 'anthropic' | 'google',
  options: NonNullable<Parameters<typeof imageFixture>[1]> = {},
) {
  if (kind === 'anthropic') return imageFixture(kind, options);
  const usage = options.missingUsage
    ? undefined
    : { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 };
  const parts =
    options.mode === 'function'
      ? [{ functionCall: { id: 'call', name: 'lookup', args: {} } }]
      : options.mode === 'refusal'
        ? []
        : [{ text: 'reply' }];
  const finish = options.mode === 'refusal' ? 'SAFETY' : 'STOP';
  return probabilityFixture(kind, undefined, {
    ...options,
    reply: () =>
      options.stream
        ? new Response(
            frames([
              chunk(parts, undefined, undefined, 'upstream-model'),
              chunk([], finish, usage, 'upstream-model'),
            ]),
            { headers: { 'content-type': 'text/event-stream' } },
          )
        : Response.json({
            responseId: 'completion',
            modelVersion: 'upstream-model',
            candidates: [{ content: { parts }, finishReason: finish }],
            ...(usage === undefined ? {} : { usageMetadata: usage }),
          }),
  });
}
