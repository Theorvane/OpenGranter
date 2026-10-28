import assert from 'node:assert/strict';
import { tool } from 'ai';
import { z } from 'zod';
import { type ProbabilityKind, probabilityFixture } from './nonstream-logprobs-fixture.ts';

const calls = [
  { id: 'call_a', name: 'lookup', args: { query: 'private one' } },
  { id: 'call_b', name: 'lookup', args: { query: 'private two' } },
];
const compatibleCalls = calls.map(({ id, name, args }) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
}));

export function nonstreamToolFixture(
  kind: ProbabilityKind,
  gate?: NonNullable<Parameters<typeof probabilityFixture>[2]>['gate'],
) {
  let replies = 0;
  const f = probabilityFixture(kind, undefined, {
    ...(gate === undefined ? {} : { gate }),
    reply: () => {
      const first = ++replies === 1;
      if (kind === 'anthropic')
        return Response.json({
          id: 'completion',
          content: first
            ? calls.map(({ id, name, args }) => ({ type: 'tool_use', id, name, input: args }))
            : [{ type: 'text', text: 'private final answer' }],
          stop_reason: first ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 2, output_tokens: 3 },
        });
      if (kind === 'google')
        return Response.json({
          responseId: 'completion',
          candidates: [
            {
              content: {
                role: 'model',
                parts: first
                  ? calls.map(({ id, name, args }) => ({ functionCall: { id, name, args } }))
                  : [{ text: 'private final answer' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 7 },
        });
      return Response.json({
        id: 'completion',
        created: 42,
        model: 'upstream-model',
        choices: [
          {
            index: 0,
            finish_reason: first ? 'tool_calls' : 'stop',
            message: first
              ? { role: 'assistant', content: null, tool_calls: compatibleCalls }
              : { role: 'assistant', content: 'private final answer' },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 7 },
      });
    },
  });
  let authenticated = 0,
    limits = 0,
    requests = 0;
  const originalAuthenticate = f.ports.authenticate;
  const originalLimit = f.ports.checkLimit;
  const ports = {
    ...f.ports,
    newRequestId: () => `req-nonstream-${++requests}`,
    authenticate: async (...args: Parameters<typeof originalAuthenticate>) => {
      authenticated++;
      assert.equal(args[0], 'fixture-proxy-key');
      return originalAuthenticate(...args);
    },
    checkLimit: async (...args: Parameters<typeof originalLimit>) => {
      limits++;
      return originalLimit(...args);
    },
  };
  return { ...f, ports, observed: () => ({ authenticated, limits }) };
}

export function parallelLookup() {
  const completed: string[] = [];
  let releaseFirst: () => void = () => assert.fail('Missing parallel lookup barrier');
  const secondStarted = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const tools = {
    lookup: tool({
      inputSchema: z.object({ query: z.enum(['private one', 'private two']) }),
      execute: async ({ query }) => {
        if (query === 'private one') await secondStarted;
        else releaseFirst();
        completed.push(query);
        return query === 'private one' ? 'private result one' : 'private result two';
      },
    }),
  };
  return { tools, completed };
}

export function assertNativeContinuation(kind: ProbabilityKind, body: Record<string, unknown>) {
  assert.equal(body.stream, kind === 'anthropic' || kind === 'google' ? undefined : false);
  if (kind === 'google') {
    assert.deepEqual(body.contents, [
      { role: 'user', parts: [{ text: 'private prompt' }] },
      {
        role: 'model',
        parts: calls.map(({ id, name, args }) => ({ functionCall: { id, name, args } })),
      },
      {
        role: 'user',
        parts: calls.map(({ id, name }, i) => ({
          functionResponse: {
            id,
            name,
            response: { output: i === 0 ? 'private result one' : 'private result two' },
          },
        })),
      },
    ]);
    return;
  }
  if (kind === 'anthropic') {
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'private prompt' },
      {
        role: 'assistant',
        content: calls.map(({ id, name, args }) => ({ type: 'tool_use', id, name, input: args })),
      },
      {
        role: 'user',
        content: calls.map(({ id }, i) => ({
          type: 'tool_result',
          tool_use_id: id,
          content: i === 0 ? 'private result one' : 'private result two',
        })),
      },
    ]);
    return;
  }
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'private prompt' },
    { role: 'assistant', content: null, tool_calls: compatibleCalls },
    { role: 'tool', tool_call_id: 'call_a', content: 'private result one' },
    { role: 'tool', tool_call_id: 'call_b', content: 'private result two' },
  ]);
  assert.equal(body.model, 'upstream-model');
  assert.deepEqual(body.provider, kind === 'openrouter' ? { only: ['provider'] } : undefined);
}
