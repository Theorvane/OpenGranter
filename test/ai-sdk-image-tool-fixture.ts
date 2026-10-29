import assert from 'node:assert/strict';
import { tool } from 'ai';
import { z } from 'zod';
import { openCodeGatewayFixture } from '../scripts/opencode-gateway-fixture.ts';
import { nonstreamToolFixture, parallelLookup } from './ai-sdk-nonstream-tool-fixture.ts';
import { inlineUrl } from './inline-image-inputs-fixture.ts';
import type { ProbabilityKind } from './nonstream-logprobs-fixture.ts';

const base64 = inlineUrl.split(',')[1] ?? assert.fail('Missing PNG fixture');
const before = 'private image question Ω',
  after = 'private trailing text';
export const imageToolInput = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: before },
      {
        type: 'image' as const,
        image: new Uint8Array(Buffer.from(base64, 'base64')),
        mediaType: 'image/png',
      },
      { type: 'text' as const, text: after },
    ],
  },
];
export async function noImageToolDownloads(requested: readonly unknown[]) {
  assert.deepEqual(requested, [], 'Inline bytes must not request remote media');
  return [];
}

export function imageToolFixture(kind: ProbabilityKind, stream: boolean) {
  if (!stream) {
    const f = nonstreamToolFixture(kind);
    return { ...f, token: 'fixture-proxy-key' };
  }
  const f = openCodeGatewayFixture(
    'tools',
    kind === 'openrouter' ? 'delegated' : 'managed',
    kind === 'openrouter' ? 'openai' : kind,
  );
  let requests = 0;
  return {
    ports: { ...f.ports, newRequestId: () => `req-image-tool-${++requests}` },
    sent: f.sent,
    records: f.usage,
    audits: f.audit,
    counts: () => ({ secrets: f.counts().secrets }),
    observed: () => ({ authenticated: f.counts().authenticated, limits: f.counts().limits }),
    token: 'fixture-proxy-token',
  };
}

export function imageToolExecution(stream: boolean) {
  if (!stream) return parallelLookup();
  const completed: string[] = [];
  return {
    completed,
    tools: {
      read: tool({
        inputSchema: z.object({ filePath: z.literal('fixture.txt') }),
        execute: async ({ filePath }) => {
          completed.push(filePath);
          return 'fixture-tool-result';
        },
      }),
    },
  };
}

export function assertImageToolHistory(
  kind: ProbabilityKind,
  stream: boolean,
  body: Record<string, unknown>,
  continuation: boolean,
) {
  const calls = stream
    ? [
        {
          id: 'call_read',
          name: 'read',
          args: { filePath: 'fixture.txt' },
          result: 'fixture-tool-result',
        },
      ]
    : [
        {
          id: 'call_a',
          name: 'lookup',
          args: { query: 'private one' },
          result: 'private result one',
        },
        {
          id: 'call_b',
          name: 'lookup',
          args: { query: 'private two' },
          result: 'private result two',
        },
      ];
  if (kind === 'google') {
    assert.deepEqual(body.contents, [
      {
        role: 'user',
        parts: [
          { text: before },
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: after },
        ],
      },
      ...(continuation
        ? [
            {
              role: 'model',
              parts: calls.map(({ id, name, args }) => ({ functionCall: { id, name, args } })),
            },
            {
              role: 'user',
              parts: calls.map(({ id, name, result }) => ({
                functionResponse: { id, name, response: { output: result } },
              })),
            },
          ]
        : []),
    ]);
    assert.equal(body.model, undefined);
  } else if (kind === 'anthropic') {
    assert.deepEqual(body.messages, [
      {
        role: 'user',
        content: [
          { type: 'text', text: before },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: after },
        ],
      },
      ...(continuation
        ? [
            {
              role: 'assistant',
              content: calls.map(({ id, name, args }) => ({
                type: 'tool_use',
                id,
                name,
                input: args,
              })),
            },
            {
              role: 'user',
              content: calls.map(({ id, result }) => ({
                type: 'tool_result',
                tool_use_id: id,
                content: result,
              })),
            },
          ]
        : []),
    ]);
    assert.equal(body.model, stream ? 'claude-exact' : 'upstream-model');
  } else {
    assert.deepEqual(body.messages, [
      {
        role: 'user',
        content: [
          { type: 'text', text: before },
          { type: 'image_url', image_url: { url: inlineUrl } },
          { type: 'text', text: after },
        ],
      },
      ...(continuation
        ? [
            {
              role: 'assistant',
              content: null,
              tool_calls: calls.map(({ id, name, args }) => ({
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              })),
            },
            ...calls.map(({ id, result }) => ({ role: 'tool', tool_call_id: id, content: result })),
          ]
        : []),
    ]);
    assert.equal(
      body.model,
      stream ? (kind === 'openrouter' ? 'openai/example' : 'gpt-exact') : 'upstream-model',
    );
  }
  assert.deepEqual(
    body.provider,
    kind === 'openrouter' ? { only: [stream ? 'OpenAI' : 'provider'] } : undefined,
  );
}

export function imageToolPrivacy(audits: unknown, records: unknown) {
  assert.doesNotMatch(
    JSON.stringify([audits, records]),
    /private|image_url|imageUrl|base64|data:image|iVBOR|filePath|fixture\.txt|fixture-tool-result|fixture-final-answer|fixture-(?:proxy|provider|upstream)-(?:key|token)/u,
  );
}
