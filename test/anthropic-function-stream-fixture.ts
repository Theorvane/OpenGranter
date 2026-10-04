export const start = (
  model = 'claude-exact',
  usage: unknown = { input_tokens: 2, output_tokens: 0 },
) => ({
  type: 'message_start',
  message: {
    id: 'gen',
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage,
  },
});
export const tool = (index = 0, id = 'call_one', name = 'lookup', input: unknown = {}) => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'tool_use', id, name, input },
});
export const fragment = (index = 0, partial_json = '{"q":"private 終"}') => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'input_json_delta', partial_json },
});
export const close = (index = 0) => ({ type: 'content_block_stop', index });
export const text = (index = 0) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text: 'private final answer' },
  },
  close(index),
];
export const terminal = (
  stop_reason: string | null = 'tool_use',
  usage: unknown = { output_tokens: 3 },
) => ({ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage });
export const stop = { type: 'message_stop' };
export const frames = (events: readonly object[]) =>
  events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('');
export const native = (answered = false, model = 'claude-exact', missing = false) => [
  start(model, missing ? null : undefined),
  ...(answered
    ? text()
    : [
        tool(),
        fragment(0, ''),
        fragment(0, '{"q":'),
        fragment(0, '"private 終"}'),
        close(),
        tool(1, 'call_two'),
        fragment(1, '{"q":"private'),
        fragment(1, ' 😀"}'),
        close(1),
      ]),
  terminal(answered ? 'end_turn' : 'tool_use', missing ? null : undefined),
  stop,
];
