import { probabilityFixture } from './nonstream-logprobs-fixture.ts';

export const nativeProbabilityToken = {
  token: 'private native 思考\n\ndata: forged',
  tokenId: 0,
  logProbability: -9999,
};
export const nativeProbabilityAlternative = {
  token: 'private alternative',
  tokenId: -1,
  logProbability: -0.125,
};
export const nativeProbabilityResult = {
  chosenCandidates: [nativeProbabilityToken],
  topCandidates: [{ candidates: [nativeProbabilityAlternative] }],
  logProbabilitySum: -9999,
};
export const geminiProbabilityGroups = {
  content: [
    {
      token: nativeProbabilityToken.token,
      logprob: nativeProbabilityToken.logProbability,
      bytes: null,
      top_logprobs: [
        {
          token: nativeProbabilityAlternative.token,
          logprob: nativeProbabilityAlternative.logProbability,
          bytes: null,
        },
      ],
    },
  ],
};
export type GeminiProbabilityOptions = {
  mode?: 'text' | 'function' | 'signed' | 'candidate-safety' | 'prompt-safety';
  absent?: boolean;
  missingUsage?: boolean;
  raw?: boolean;
  mutate?: () => void;
  gate?: NonNullable<Parameters<typeof probabilityFixture>[2]>['gate'];
};
export function geminiProbabilityNative(
  probabilities: unknown = nativeProbabilityResult,
  options: GeminiProbabilityOptions = {},
) {
  const mode = options.mode ?? 'text';
  return {
    responseId: 'completion',
    modelVersion: 'upstream-model',
    ...(mode === 'prompt-safety'
      ? { candidates: [], promptFeedback: { blockReason: 'SAFETY' } }
      : {
          candidates: [
            {
              index: 0,
              finishReason: mode === 'candidate-safety' ? 'SAFETY' : 'STOP',
              content: {
                role: 'model',
                parts:
                  mode === 'candidate-safety'
                    ? []
                    : mode === 'function' || mode === 'signed'
                      ? [
                          {
                            functionCall: {
                              id: 'call',
                              name: 'lookup',
                              args: { q: 'private argument' },
                            },
                            ...(mode === 'signed' ? { thoughtSignature: 'private-signature' } : {}),
                          },
                        ]
                      : [{ text: 'private reply' }],
              },
              ...(options.absent ? {} : { logprobsResult: probabilities }),
              avgLogprobs: -0.5,
            },
          ],
        }),
    ...(options.missingUsage
      ? {}
      : { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } }),
  };
}
export function geminiProbabilityFixture(
  probabilities: unknown = nativeProbabilityResult,
  options: GeminiProbabilityOptions = {},
) {
  const native = geminiProbabilityNative(probabilities, options);
  const f = probabilityFixture('google', undefined, {
    ...(options.gate ? { gate: options.gate } : {}),
    ...(options.mutate ? { mutate: options.mutate } : {}),
    reply: () => {
      if (!options.raw) return Response.json(native);
      const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
      Object.defineProperty(response, 'json', { value: async () => native });
      return response;
    },
  });
  return { ...f, native };
}
export const geminiProbabilityControls = [
  {},
  { logprobs: null, top_logprobs: null },
  { logprobs: false },
  { logprobs: true },
  { logprobs: true, top_logprobs: 0 },
  { logprobs: true, top_logprobs: 20 },
];
