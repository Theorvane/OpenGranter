import assert from 'node:assert/strict';
import {
  probabilityFixture,
  probabilityGroups,
  probabilityToken,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

export const finalProbabilities = {
  content: [{ ...probabilityToken, token: 'private-terminal-probability' }],
  refusal: null,
};
export const streamScope = { upstreamModelId: 'upstream-model', clientModelAlias: 'chat' };
export function probabilityChunk(choices: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'completion',
    object: 'chat.completion.chunk',
    created: 42,
    model: 'upstream-model',
    system_fingerprint: 'fp_fixture',
    choices,
    ...extra,
  });
}
export type ProbabilityStreamOptions = {
  mode?: 'text' | 'refusal' | 'function';
  groups?: unknown;
  absent?: boolean;
  missingUsage?: boolean;
  emptyUsage?: boolean;
  finalGroups?: unknown;
  invalid?: 'first' | 'later' | 'final' | 'location' | 'native-usage';
  gate?: NonNullable<Parameters<typeof probabilityFixture>[2]>['gate'];
};
export function probabilityStreamPayloads(
  kind: 'openai' | 'openrouter',
  options: ProbabilityStreamOptions = {},
) {
  const mode = options.mode ?? 'text';
  const finish =
    mode === 'function' ? 'tool_calls' : mode === 'refusal' ? 'content_filter' : 'stop';
  const groups = Object.hasOwn(options, 'groups') ? options.groups : probabilityGroups;
  const invalid = { content: [{ ...probabilityToken, bytes: [256] }] };
  const delta =
    mode === 'function'
      ? {
          tool_calls: [
            {
              index: 0,
              id: 'call',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            },
          ],
        }
      : mode === 'refusal'
        ? { refusal: 'private refusal' }
        : { content: 'private answer' };
  const first = probabilityChunk(
    [
      {
        index: 0,
        delta: {
          role: 'assistant',
          ...delta,
          ...(options.invalid === 'location' ? { logprobs: groups } : {}),
        },
        finish_reason: null,
        ...(options.absent ? {} : { logprobs: options.invalid === 'first' ? invalid : groups }),
      },
    ],
    kind === 'openai' ? { usage: null } : {},
  );
  const terminal = probabilityChunk([
    {
      index: 0,
      delta: {},
      finish_reason: finish,
      logprobs: options.invalid === 'later' ? invalid : null,
    },
  ]);
  const usage = probabilityChunk(
    kind === 'openai' || options.emptyUsage
      ? []
      : [
          {
            index: 0,
            delta: {},
            finish_reason: finish,
            logprobs:
              options.invalid === 'final'
                ? invalid
                : Object.hasOwn(options, 'finalGroups')
                  ? options.finalGroups
                  : finalProbabilities,
          },
        ],
    {
      usage: options.missingUsage
        ? {}
        : { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    },
  );
  return [
    options.invalid === 'native-usage'
      ? probabilityChunk([{ index: 0, delta: { content: 'private' }, finish_reason: null }], {
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        })
      : first,
    terminal,
    usage,
    '[DONE]',
  ];
}
export function probabilityStreamResponse(payloads: string[]) {
  return new Response(payloads.map((p) => `data: ${p}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
export function streamProbabilityFixture(
  kind: 'openai' | 'openrouter',
  options: ProbabilityStreamOptions = {},
) {
  return probabilityFixture(kind, probabilityGroups, {
    ...(options.gate === undefined ? {} : { gate: options.gate }),
    reply: () => probabilityStreamResponse(probabilityStreamPayloads(kind, options)),
  });
}
export function streamProbabilityFields(mode = 'text', fields: Record<string, unknown> = {}) {
  return {
    stream: true,
    logprobs: true,
    top_logprobs: 20,
    ...(mode === 'function' ? { tools: probabilityTools } : {}),
    ...fields,
  };
}
export function probabilityFrames(text: string) {
  assert.ok(text.endsWith('data: [DONE]\n\n'), text);
  return text
    .trim()
    .split('\n\n')
    .filter((s) => s !== 'data: [DONE]')
    .map(
      (s) =>
        JSON.parse(s.slice(6)) as {
          choices: {
            logprobs?: unknown;
            delta: Record<string, unknown>;
            finish_reason: string | null;
          }[];
          usage?: { total_tokens: number };
        },
    );
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
