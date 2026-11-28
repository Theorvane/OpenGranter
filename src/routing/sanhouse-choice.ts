import type { JevChoiceRequest } from './owned-strategy.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Consumer parser for Infra's historical observation, not a promised server schema.
 * Concentration thresholds are conservative heuristics, never calibrated correctness or IAM.
 */
export function decodeSanhouseResearchChoice(
  response: unknown,
  options: readonly string[],
): string | undefined {
  if (
    !record(response) ||
    response.license !== 'CC-BY-NC-4.0' ||
    response.commercial_use_authorized !== false ||
    response.action_authorization !== false ||
    response.probabilities_calibrated !== false ||
    response.truncated !== false ||
    typeof response.index !== 'number' ||
    !Number.isSafeInteger(response.index) ||
    response.index < 0 ||
    response.index >= options.length ||
    response.choice !== options[response.index] ||
    !Array.isArray(response.probabilities) ||
    response.probabilities.length !== options.length ||
    !response.probabilities.every(
      (p: unknown) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1,
    )
  )
    return undefined;
  const probabilities: number[] = response.probabilities;
  if (Math.abs(probabilities.reduce((sum, p) => sum + p, 0) - 1) > 0.00001) return undefined;
  const selected = probabilities[response.index];
  if (
    selected === undefined ||
    selected < 0.7 ||
    probabilities.some((p, index) => index !== response.index && selected - p < 0.2)
  )
    return undefined;
  return options[response.index];
}

/** Fixed Sanhouse Choice transport. Resolve only inside an enabled research strategy call. */
export function createSanhouseTransport(ports: {
  readonly credentialRef: string;
  readonly resolveSecret: (credentialRef: string) => Promise<string | undefined>;
  readonly fetcher?: typeof fetch;
}): (request: JevChoiceRequest, signal: AbortSignal) => Promise<unknown> {
  const { credentialRef, resolveSecret } = ports;
  const fetcher = ports.fetcher ?? fetch;
  return async (request, signal) => {
    try {
      const key = await resolveSecret(credentialRef);
      if (!key || signal.aborted) throw new Error('Unavailable');
      const response = await fetcher('https://jev.sanhouse.kr/v1/decisions', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Unavailable');
      }
      return await response.json();
    } catch {
      // No raw error, body, credential, or decision state escapes this boundary.
      throw new Error('Jev decision unavailable');
    }
  };
}
