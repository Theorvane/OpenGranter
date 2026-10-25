import assert from 'node:assert/strict';
import {
  close,
  fragment,
  frames,
  start,
  stop,
  terminal,
  text,
  tool,
} from './anthropic-function-stream-fixture.ts';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';

export function anthropicTierFixture(
  options: NonNullable<Parameters<typeof clientUserFixture>[1]> = {},
) {
  const mode = options.mode ?? 'text';
  return clientUserFixture('anthropic', {
    ...options,
    reply: () => {
      const reason = mode === 'function' ? 'tool_use' : mode === 'refusal' ? 'refusal' : 'end_turn';
      const usage = options.missingUsage ? null : { input_tokens: 2, output_tokens: 3 };
      if (!options.stream)
        return Response.json({
          id: 'completion',
          stop_reason: reason,
          content:
            mode === 'function'
              ? [
                  {
                    type: 'tool_use',
                    id: 'call_one',
                    name: 'lookup',
                    input: { q: 'private native argument' },
                  },
                ]
              : mode === 'refusal'
                ? []
                : [{ type: 'text', text: 'private native answer' }],
          usage,
        });
      return new Response(
        frames([
          start(
            'upstream-model',
            options.missingUsage ? null : { input_tokens: 2, output_tokens: 0 },
          ),
          ...(mode === 'function' ? [tool(), fragment(), close()] : text()),
          terminal(reason, options.missingUsage ? null : { output_tokens: 3 }),
          stop,
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
}
export function anthropicTierPrivacy(f: ReturnType<typeof anthropicTierFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /service_tier|serviceTier|standard_only/u,
  );
}
