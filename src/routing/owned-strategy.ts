/** Selection receives only immutable, already eligible destination metadata. */
export interface StrategyCandidate {
  readonly id: string;
  readonly priority: number;
  readonly providerId: string;
  readonly upstreamModelId: string;
}

export interface RoutingStrategy {
  readonly id: string;
  select(
    candidates: readonly StrategyCandidate[],
  ): Promise<{ readonly candidateId: string } | undefined>;
}

/** Lower administrator priority wins; IDs break ties independently of storage order/locale. */
export function administratorOrder<T extends StrategyCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(
    (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export const administratorPriorityStrategy: RoutingStrategy = Object.freeze({
  id: 'administrator-priority',
  async select(candidates: readonly StrategyCandidate[]) {
    const first = administratorOrder(candidates)[0];
    return first ? { candidateId: first.id } : undefined;
  },
});

export interface JevChoiceRequest {
  readonly state: { readonly candidates: readonly StrategyCandidate[]; readonly prompt?: string };
  readonly instruction: string;
  readonly options: readonly string[];
}

export interface JevStrategyConfig {
  readonly enabled?: boolean;
  /** This endpoint's observed license excludes commercial/production use. */
  readonly environment?: 'research' | 'production';
  readonly sharePrompt?: boolean;
  readonly promptText?: string;
  /** Transport must use the Sanhouse adapter and a server-held credential reference. */
  readonly fetchDecision: (request: JevChoiceRequest, signal: AbortSignal) => Promise<unknown>;
  /** Missing decoder fails closed. The server does not promise a stable success schema. */
  readonly decode?: (response: unknown, options: readonly string[]) => string | undefined;
  readonly timeoutMs?: number;
}

/** Recommendation only; the coordinator validates membership and supplies deterministic fallback. */
export function createJevStrategy(config: JevStrategyConfig): RoutingStrategy {
  const { enabled, environment, sharePrompt, promptText, fetchDecision, decode } = config;
  const timeoutMs = config.timeoutMs ?? 3000;
  return Object.freeze({
    id: 'jev-research',
    async select(candidates: readonly StrategyCandidate[]) {
      if (
        enabled !== true ||
        environment !== 'research' ||
        candidates.length === 0 ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 3000
      )
        return undefined;
      const options = candidates.map((candidate) => candidate.id);
      if (new Set(options).size !== options.length || options.length > 255) return undefined;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(undefined);
          }, timeoutMs);
        });
        const operation = async () => {
          const response = await fetchDecision(
            {
              state: {
                candidates,
                ...(sharePrompt === true && promptText !== undefined ? { prompt: promptText } : {}),
              },
              instruction: 'Which approved destination best matches the request metadata?',
              options,
            },
            controller.signal,
          );
          const candidateId = decode?.(response, options);
          return typeof candidateId === 'string' && options.includes(candidateId)
            ? { candidateId }
            : undefined;
        };
        return await Promise.race([operation(), timeout]);
      } catch {
        return undefined;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  });
}
