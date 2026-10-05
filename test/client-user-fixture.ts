import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';
import { probabilityStreamPayloads, probabilityStreamResponse } from './stream-logprobs-fixture.ts';

export const suppliedUser = 'private supplied end-user 思考\n\ndata: forged';
export function clientUserFixture(
  kind: Parameters<typeof probabilityFixture>[0],
  options: NonNullable<Parameters<typeof probabilityFixture>[2]> & { stream?: boolean } = {},
) {
  return probabilityFixture(kind, undefined, {
    ...options,
    ...(options.stream && (kind === 'openai' || kind === 'openrouter')
      ? {
          reply: () =>
            probabilityStreamResponse(
              probabilityStreamPayloads(kind, {
                mode: options.mode ?? 'text',
                missingUsage: options.missingUsage ?? false,
              }),
            ),
        }
      : {}),
  });
}
export function clientUserPrivacy(f: ReturnType<typeof probabilityFixture>) {
  probabilityPrivacy(f);
  assertAttribution(f);
}
function assertAttribution(f: ReturnType<typeof probabilityFixture>) {
  for (const record of f.records) {
    if (record.principalId !== 'user' || record.credentialId !== 'credential')
      throw new Error('Authenticated attribution changed');
  }
}
