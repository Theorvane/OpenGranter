export const chunk = (
  parts: readonly object[] = [],
  finishReason?: string,
  usageMetadata?: unknown,
  modelVersion = 'gemini-exact',
) => ({
  responseId: 'gen',
  modelVersion,
  candidates: [
    {
      index: 0,
      content: { role: 'model', parts },
      ...(finishReason === undefined ? {} : { finishReason }),
    },
  ],
  ...(usageMetadata === undefined ? {} : { usageMetadata }),
});
export const call = (id: string | undefined = 'call_one', args: unknown = { q: 'private 終' }) => ({
  functionCall: { ...(id === undefined ? {} : { id }), name: 'lookup', args },
});
export const frames = (events: readonly object[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
export const native = (answered = false, model = 'gemini-exact', missing = false) => [
  chunk(answered ? [{ text: 'private final answer' }] : [call()], undefined, undefined, model),
  ...(answered
    ? []
    : [chunk([call('call_two', { q: 'private 😀' })], undefined, undefined, model)]),
  chunk(
    [],
    'STOP',
    missing ? null : { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 7 },
    model,
  ),
];
