import type { RouteCandidate } from './authorize-candidates.ts';
import {
  type ManagedSelectionInput,
  selectAuthorizedManagedCandidate,
} from './select-managed-candidate.ts';

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MAX_CHOICES = 255;

export interface JevHttpResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type JevFetcher = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<JevHttpResponse>;

export interface JevConfig {
  /** Resolved from a server-held secret reference; never persisted in route data. */
  readonly apiKey: string;
  readonly minimumConfidence: number;
  readonly sendPrompt: boolean;
}

export interface JevManagedSelectionInput extends Omit<ManagedSelectionInput, 'select'> {
  readonly jev: JevConfig;
  readonly promptText?: string;
  readonly fetcher?: JevFetcher;
}

export type JevDecision =
  | {
      readonly source: 'jev';
      readonly model: string;
      readonly confidence: number;
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | {
      readonly source: 'fallback';
      readonly reason: 'unavailable' | 'invalid-response' | 'invalid-choice' | 'low-confidence';
      readonly model?: string;
      readonly confidence?: number;
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
    };

export type JevManagedSelectionResult =
  | { readonly status: 'no-candidates' }
  | {
      readonly status: 'selected';
      readonly candidate: RouteCandidate;
      readonly decision: JevDecision;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsage(value: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (!isRecord(value)) return undefined;
  const input = value.input_tokens;
  const output = value.output_tokens;
  if (
    typeof input !== 'number' ||
    typeof output !== 'number' ||
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0
  ) {
    return undefined;
  }
  return { inputTokens: input, outputTokens: output };
}

/** Ask Jev to choose from the pre-authorized direct set; retain local control of invocation. */
export async function selectManagedWithJev(
  input: JevManagedSelectionInput,
): Promise<JevManagedSelectionResult> {
  if (
    !Number.isFinite(input.jev.minimumConfidence) ||
    input.jev.minimumConfidence < 0 ||
    input.jev.minimumConfidence > 1
  ) {
    throw new RangeError('Invalid Jev confidence threshold');
  }

  let decision: JevDecision = { source: 'fallback', reason: 'unavailable' };
  const result = await selectAuthorizedManagedCandidate({
    principalActive: input.principalActive,
    modelAlias: input.modelAlias,
    candidates: input.candidates,
    statements: input.statements,
    select: async (eligible) => {
      const first = eligible[0];
      if (!first) throw new Error('Managed selector received no candidates');
      if (eligible.length > MAX_CHOICES) {
        decision = { source: 'fallback', reason: 'invalid-response' };
        return first.id;
      }

      const criteria = Object.fromEntries(
        eligible.map((candidate) => [
          candidate.id,
          `Provider ${candidate.providerId}; model ${candidate.upstreamModelId}`,
        ]),
      );
      if (Object.keys(criteria).length !== eligible.length) {
        decision = { source: 'fallback', reason: 'invalid-response' };
        return first.id;
      }

      const state = {
        modelAlias: input.modelAlias,
        ...(input.jev.sendPrompt && input.promptText !== undefined
          ? { prompt: input.promptText }
          : {}),
      };
      try {
        const fetcher = input.fetcher ?? fetch;
        const response = await fetcher(JEV_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.jev.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            state,
            model: 'jev-latest',
            questions: {
              route: {
                type: 'choice',
                instructions:
                  'Choose the best approved direct model and provider for this request.',
                criteria,
              },
            },
          }),
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
          decision = { source: 'fallback', reason: 'unavailable' };
          return first.id;
        }
        const data: unknown = await response.json();
        const answer = isRecord(data) && isRecord(data.answers) ? data.answers.route : undefined;
        const usage = isRecord(data) ? readUsage(data.usage) : undefined;
        if (
          !isRecord(data) ||
          typeof data.model !== 'string' ||
          !isRecord(answer) ||
          answer.type !== 'choice' ||
          typeof answer.choice !== 'string' ||
          typeof answer.confidence !== 'number' ||
          !Number.isFinite(answer.confidence) ||
          answer.confidence < 0 ||
          answer.confidence > 1
        ) {
          decision = { source: 'fallback', reason: 'invalid-response' };
          return first.id;
        }
        if (!eligible.some((candidate) => candidate.id === answer.choice)) {
          decision = {
            source: 'fallback',
            reason: 'invalid-choice',
            model: data.model,
            confidence: answer.confidence,
            ...(usage ? { usage } : {}),
          };
          return first.id;
        }
        if (answer.confidence < input.jev.minimumConfidence) {
          decision = {
            source: 'fallback',
            reason: 'low-confidence',
            model: data.model,
            confidence: answer.confidence,
            ...(usage ? { usage } : {}),
          };
          return first.id;
        }
        decision = {
          source: 'jev',
          model: data.model,
          confidence: answer.confidence,
          ...(usage ? { usage } : {}),
        };
        return answer.choice;
      } catch {
        // Do not include the upstream response or exception, which may contain secrets or content.
        decision = { source: 'fallback', reason: 'unavailable' };
        return first.id;
      }
    },
  });

  if (result.status === 'no-candidates') return result;
  if (result.status === 'invalid-choice') {
    throw new Error('Managed selector returned an invalid candidate');
  }
  return { ...result, decision };
}
