import type { OpenRouterModelMetadata } from './model-discovery-metadata.ts';
import type { BenchmarkSort } from './model-list-query.ts';

function score(metadata: OpenRouterModelMetadata | undefined, sort: BenchmarkSort) {
  const benchmarks = metadata?.benchmarks;
  switch (sort) {
    case 'intelligence-high-to-low':
      return benchmarks?.artificial_analysis?.intelligence_index ?? undefined;
    case 'coding-high-to-low':
      return benchmarks?.artificial_analysis?.coding_index ?? undefined;
    case 'agentic-high-to-low':
      return benchmarks?.artificial_analysis?.agentic_index ?? undefined;
    case 'design-arena-elo-high-to-low': {
      let best: number | undefined;
      for (const row of benchmarks?.design_arena ?? [])
        if (best === undefined || row.elo > best) best = row.elo;
      return best;
    }
  }
}

export function compareModelBenchmarks(
  sort: BenchmarkSort,
  left: OpenRouterModelMetadata | undefined,
  right: OpenRouterModelMetadata | undefined,
): number {
  const leftScore = score(left, sort);
  const rightScore = score(right, sort);
  if (leftScore === undefined) return rightScore === undefined ? 0 : 1;
  if (rightScore === undefined) return -1;
  return leftScore === rightScore ? 0 : leftScore > rightScore ? -1 : 1;
}
