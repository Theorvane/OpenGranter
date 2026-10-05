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
import { clientUserFixture } from './client-user-fixture.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

export const suppliedCacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };
export function cacheControlFixture(
  kind: Parameters<typeof probabilityFixture>[0],
  options: NonNullable<Parameters<typeof probabilityFixture>[2]> & {
    stream?: boolean;
    nativeUsage?: unknown;
  } = {},
) {
  if (kind !== 'anthropic') return clientUserFixture(kind, options);
  const mode = options.mode ?? 'text';
  const reason = mode === 'refusal' ? 'refusal' : mode === 'function' ? 'tool_use' : 'end_turn';
  const usage = options.missingUsage
    ? undefined
    : (options.nativeUsage ?? { input_tokens: 2, output_tokens: 1 });
  return probabilityFixture(kind, undefined, {
    ...options,
    reply: () => {
      if (!options.stream)
        return Response.json({
          id: 'completion',
          model: 'upstream-model',
          stop_reason: reason,
          content:
            mode === 'refusal'
              ? []
              : mode === 'function'
                ? [{ type: 'tool_use', id: 'call', name: 'lookup', input: {} }]
                : [{ type: 'text', text: 'reply' }],
          ...(usage === undefined ? {} : { usage }),
        });
      const initial = start('upstream-model', usage);
      initial.message.usage = usage;
      const final = terminal(reason, undefined);
      final.usage =
        usage === undefined
          ? undefined
          : { output_tokens: (usage as Record<string, unknown>).output_tokens };
      return new Response(
        frames([
          initial,
          ...(mode === 'refusal'
            ? []
            : mode === 'function'
              ? [tool(0, 'call'), fragment(0, '{}'), close()]
              : text()),
          final,
          stop,
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
}
export function cacheControlPrivacy(f: ReturnType<typeof probabilityFixture>) {
  probabilityPrivacy(f);
  assertNoControls(f);
}
function assertNoControls(f: ReturnType<typeof probabilityFixture>) {
  if (
    /cache_control|ephemeral|"ttl"/u.test(JSON.stringify({ records: f.records, audits: f.audits }))
  )
    throw Error('Cache controls entered operational metadata');
  for (const r of f.records)
    if (r.principalId !== 'user' || r.credentialId !== 'credential')
      throw Error('Changed authenticated attribution');
}
