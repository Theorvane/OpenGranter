import { compareUsageCosts, type UsageCostComparison } from './cost-comparison.ts';
import { parseStoredUsageRecord } from './history.ts';
import type { UsageRecord } from './record-usage.ts';

export interface UsageJsonRecord extends UsageRecord {
  readonly costComparison: UsageCostComparison;
}

/** Validated additive read projection, never a persistence or invoice reconciliation record. */
export function projectUsageJson(value: unknown): UsageJsonRecord {
  const record = parseStoredUsageRecord(value);
  return { ...record, costComparison: compareUsageCosts(record) };
}
