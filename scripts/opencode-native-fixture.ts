import assert from 'node:assert/strict';

export type OpenCodeNativeProvider = 'openai' | 'anthropic' | 'google';
const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function parts(body: Record<string, unknown>, provider: 'anthropic' | 'google') {
  const history = provider === 'anthropic' ? body.messages : body.contents;
  assert.ok(Array.isArray(history));
  return history.flatMap((message: unknown) => {
    const turn = record(message);
    const content = provider === 'anthropic' ? turn.content : turn.parts;
    return Array.isArray(content) ? content.map(record) : [];
  });
}
export function openCodeNativeToolNames(
  body: Record<string, unknown>,
  provider: OpenCodeNativeProvider,
): string[] {
  if (!Array.isArray(body.tools)) return [];
  if (provider === 'google')
    return body.tools.flatMap((tool: unknown) => {
      const declarations = record(tool).functionDeclarations;
      assert.ok(Array.isArray(declarations));
      return declarations.map((declaration: unknown) => {
        const name = record(declaration).name;
        assert.equal(typeof name, 'string');
        return name as string;
      });
    });
  return body.tools.map((tool: unknown) => {
    const declaration = record(tool);
    const name = provider === 'anthropic' ? declaration.name : record(declaration.function).name;
    assert.equal(typeof name, 'string');
    return name as string;
  });
}
/** Inspect mocked native results only; this helper grants no destination or execution authority. */
export function openCodeNativeHasResult(
  body: Record<string, unknown>,
  provider: OpenCodeNativeProvider,
): boolean {
  if (provider === 'openai') {
    assert.ok(Array.isArray(body.messages));
    return body.messages.some((message: unknown) => record(message).role === 'tool');
  }
  return parts(body, provider).some((part) =>
    provider === 'anthropic'
      ? part.type === 'tool_result'
      : Object.hasOwn(part, 'functionResponse'),
  );
}
export function openCodeNativeFixtureResponse(
  body: Record<string, unknown>,
  provider: 'anthropic' | 'google',
  mode: { readonly tools: boolean; readonly cancel: boolean; readonly signed: boolean },
  signal: AbortSignal | null | undefined,
  onAbort: () => void,
): Response {
  assert.equal(body.provider, undefined);
  assert.equal(body.stream_options, undefined);
  if (provider === 'anthropic') {
    assert.equal(body.model, 'claude-exact');
    assert.equal(body.stream, true);
    assert.ok(
      typeof body.max_tokens === 'number' && body.max_tokens > 0 && body.max_tokens <= 1000,
    );
  } else {
    assert.equal(body.model, undefined);
    assert.equal(body.stream, undefined);
    const config = body.generationConfig === undefined ? {} : record(body.generationConfig);
    if (config.maxOutputTokens !== undefined)
      assert.ok(
        typeof config.maxOutputTokens === 'number' &&
          config.maxOutputTokens > 0 &&
          config.maxOutputTokens <= 1000,
      );
  }
  const answered = openCodeNativeHasResult(body, provider);
  const names = openCodeNativeToolNames(body, provider);
  if (names.length) assert.deepEqual(names, ['read']);
  if (answered) {
    const history = parts(body, provider);
    if (provider === 'anthropic') {
      const result = history.find((part) => part.type === 'tool_result');
      assert.equal(result?.tool_use_id, 'call_read');
      assert.ok(
        typeof result?.content === 'string' && result.content.includes('fixture-tool-result'),
      );
      const call = history.find((part) => part.type === 'tool_use');
      assert.equal(call?.id, 'call_read');
      assert.equal(call.name, 'read');
      assert.deepEqual(call.input, { filePath: 'fixture.txt' });
    } else {
      const result = record(
        history.find((part) => Object.hasOwn(part, 'functionResponse'))?.functionResponse,
      );
      assert.equal(result.id, 'call_read');
      assert.equal(result.name, 'read');
      const output = record(result.response).output;
      assert.ok(typeof output === 'string' && output.includes('fixture-tool-result'));
      const part = history.find((part) => Object.hasOwn(part, 'functionCall'));
      const call = record(part?.functionCall);
      assert.equal(call.id, 'call_read');
      assert.equal(call.name, 'read');
      assert.deepEqual(call.args, { filePath: 'fixture.txt' });
      if (mode.signed && part?.thoughtSignature !== 'fixture-signature+/==')
        return new Response('Fixture signature required', { status: 400 });
    }
  }
  const toolTurn = mode.tools && names.length > 0 && !answered;
  const text = mode.cancel ? 'fixture-partial' : 'fixture-final-answer';
  let initial: string, remainder: string;
  if (provider === 'anthropic') {
    initial = frame({
      type: 'message_start',
      message: {
        id: 'gen-fixture',
        type: 'message',
        role: 'assistant',
        model: 'claude-exact',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 0 },
      },
    });
    if (toolTurn && !mode.cancel)
      initial +=
        frame({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'call_read', name: 'read', input: {} },
        }) +
        frame({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"filePath":' },
        }) +
        frame({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"fixture.txt"}' },
        });
    else
      initial +=
        frame({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }) + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
    remainder =
      frame({ type: 'content_block_stop', index: 0 }) +
      frame({
        type: 'message_delta',
        delta: { stop_reason: toolTurn ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 3 },
      }) +
      frame({ type: 'message_stop' });
  } else {
    const chunk = (parts: object[], terminal = false) => ({
      responseId: 'gen-fixture',
      modelVersion: 'gemini-exact',
      candidates: [
        {
          index: 0,
          content: { role: 'model', parts },
          ...(terminal ? { finishReason: 'STOP' } : {}),
        },
      ],
      ...(terminal
        ? { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 } }
        : {}),
    });
    initial = frame(
      chunk(
        toolTurn && !mode.cancel
          ? [
              {
                functionCall: { id: 'call_read', name: 'read', args: { filePath: 'fixture.txt' } },
                ...(mode.signed ? { thoughtSignature: 'fixture-signature+/==' } : {}),
              },
            ]
          : [{ text }],
      ),
    );
    remainder = frame(chunk([], true));
  }
  if (!mode.cancel)
    return new Response(initial + remainder, { headers: { 'content-type': 'text/event-stream' } });
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(initial));
        signal?.addEventListener(
          'abort',
          () => {
            onAbort();
            controller.error(new Error('Fixture transport interrupted'));
          },
          { once: true },
        );
      },
      cancel: onAbort,
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
