import { parseStoredUsageRecord } from './stored-record.ts';

export interface UsageCostComparison {
  readonly status:
    | 'unknown'
    | 'estimate_only'
    | 'reported_only'
    | 'currency_mismatch'
    | 'equal'
    | 'reported_above_estimate'
    | 'reported_below_estimate';
  readonly reportedMinusEstimated: string | null;
  readonly currency: string | null;
}

/** Exact metadata comparison only, never invoice reconciliation or currency conversion. */
export function compareUsageCosts(value: unknown): UsageCostComparison {
  const { estimatedCost: estimate, upstreamBilledCost: reported } = parseStoredUsageRecord(value);
  const unavailable = (status: UsageCostComparison['status']): UsageCostComparison => ({
    status,
    reportedMinusEstimated: null,
    currency: null,
  });
  if (estimate === null && reported === null) return unavailable('unknown');
  if (estimate === null) return unavailable('reported_only');
  if (reported === null) return unavailable('estimate_only');
  if (estimate.currency !== reported.currency) return unavailable('currency_mismatch');
  // Stored decimal validation bounds each input to 128 characters before BigInt work.
  const scale = Math.max(
    estimate.amountDecimal.split('.')[1]?.length ?? 0,
    reported.amountDecimal.split('.')[1]?.length ?? 0,
  );
  function integer(amount: string): bigint {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
  }
  const delta = integer(reported.amountDecimal) - integer(estimate.amountDecimal);
  const magnitude = (delta < 0n ? -delta : delta).toString().padStart(scale + 1, '0');
  const decimal =
    scale === 0
      ? magnitude
      : `${magnitude.slice(0, -scale)}.${magnitude.slice(-scale)}`
          .replace(/0+$/u, '')
          .replace(/\.$/u, '');
  return {
    status:
      delta === 0n ? 'equal' : delta > 0n ? 'reported_above_estimate' : 'reported_below_estimate',
    reportedMinusEstimated: `${delta < 0n ? '-' : ''}${decimal}`,
    currency: estimate.currency,
  };
}
