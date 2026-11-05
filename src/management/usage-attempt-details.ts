import type { UsageRecord } from '../usage/record-usage.ts';
import type { UsageElement } from './usage-app.ts';

/** Content-free inspection of an already authorized row; no further data fetch. */
export function renderUsageAttemptDetails(
  document: UsageElement['ownerDocument'],
  record: UsageRecord,
): UsageElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Inspect attempt';
  const fields = document.createElement('dl');
  for (const [label, value] of [
    ['Request ID', record.requestId],
    ['Attempt ID', record.attemptId],
    ['Route kind', record.routeKind],
    ['Upstream model', record.upstreamModelId],
    ['Selected candidate', record.selectedCandidateId],
    ['Actual inference provider', record.actualInferenceProviderId],
    ['Latency (ms)', record.latencyMs],
    ['Prompt tokens', record.usage.promptTokens],
    ['Completion tokens', record.usage.completionTokens],
    ['Estimated price version', record.estimatedCost?.priceVersion],
    ['Reported billing source', record.upstreamBilledCost?.source],
  ] as const) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value === null || value === undefined ? 'Unknown' : String(value);
    fields.append(term, description);
  }
  details.append(summary, fields);
  return details;
}
