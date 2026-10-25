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
export type TierReport = { tier?: unknown };
export type ServedTierOptions = NonNullable<Parameters<typeof clientUserFixture>[1]> &
  TierReport & {
    updates?: readonly TierReport[];
    final?: TierReport;
  };
const tierFields = (report: TierReport) =>
  Object.hasOwn(report, 'tier') ? { service_tier: report.tier } : {};
export function servedTierFixture(options: ServedTierOptions = {}) {
  const mode = options.mode ?? 'text';
  return clientUserFixture('anthropic', {
    ...options,
    reply: () => {
      const reason = mode === 'function' ? 'tool_use' : mode === 'refusal' ? 'refusal' : 'end_turn';
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
          usage: {
            ...(options.missingUsage ? {} : { input_tokens: 2, output_tokens: 3 }),
            ...tierFields(options),
          },
        });
      return new Response(
        frames([
          start('upstream-model', {
            ...(options.missingUsage ? {} : { input_tokens: 2, output_tokens: 0 }),
            ...tierFields(options),
          }),
          ...(mode === 'function' ? [tool(), fragment(), close()] : text()),
          ...(options.updates ?? []).map((report) =>
            terminal(null, {
              ...(options.missingUsage ? {} : { output_tokens: 1 }),
              ...tierFields(report),
            }),
          ),
          terminal(reason, {
            ...(options.missingUsage ? {} : { output_tokens: 3 }),
            ...tierFields(options.final ?? {}),
          }),
          stop,
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
}
export function servedTierPrivacy(f: ReturnType<typeof servedTierFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /service_tier|serviceTier|future-tier/u,
  );
}
export function responseChunks(body: string, stream: boolean): Record<string, unknown>[] {
  return stream
    ? body
        .split('\n')
        .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
        .map((line) => JSON.parse(line.slice(6)))
    : [JSON.parse(body)];
}
