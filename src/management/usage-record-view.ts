import { projectUsageJson } from '../shared/usage/json.ts';
import type { CatalogElement } from './catalog-view.ts';
import { formatHistoryTimestamp } from './history-timestamp.ts';

/** One already-authorized row. No fetch, cache, authority or retained content. */
export function renderUsageRecordDetails(root: CatalogElement, row: unknown): CatalogElement {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const detail = element('details');
  try {
    // Validate/copy only known fields; never trust supplied comparison or raw extras.
    const safe = projectUsageJson(row);
    detail.append(element('summary', `Usage record details · ${safe.attemptId}`));
    const fields = element('dl');
    const money = (cost: { amountDecimal: string; currency: string } | null) =>
      cost ? `${cost.amountDecimal} ${cost.currency}` : 'Unknown';
    for (const [label, value] of [
      ['Request ID', safe.requestId],
      ['Attempt ID', safe.attemptId],
      ['Occurred at (UTC)', formatHistoryTimestamp(safe.occurredAt)],
      ['Occurred at (Unix ms)', String(safe.occurredAt)],
      ['Principal ID', safe.principalId],
      ['Credential ID', safe.credentialId],
      ['Model alias', safe.modelAlias],
      ['Route kind', safe.routeKind],
      ['Upstream model', safe.upstreamModelId],
      ['Selected candidate', safe.selectedCandidateId ?? 'Unknown'],
      ['Actual inference provider', safe.actualInferenceProviderId ?? 'Unknown'],
      ['Outcome', safe.outcome],
      ['Latency (ms)', String(safe.latencyMs)],
      ['Usage status', safe.usage.status],
      ['Prompt tokens', String(safe.usage.promptTokens ?? 'Unknown')],
      ['Completion tokens', String(safe.usage.completionTokens ?? 'Unknown')],
      ['Total tokens', String(safe.usage.totalTokens ?? 'Unknown')],
      ['Estimated cost', money(safe.estimatedCost)],
      ['Price version', safe.estimatedCost?.priceVersion ?? 'Unknown'],
      ['Reported cost', money(safe.upstreamBilledCost)],
      ['Reported cost source', safe.upstreamBilledCost?.source ?? 'Unknown'],
      ['Cost comparison', safe.costComparison.status],
      ['Reported minus estimate', safe.costComparison.reportedMinusEstimated ?? 'Unknown'],
      ['Comparison currency', safe.costComparison.currency ?? 'Unknown'],
      ['Possible duplicate', safe.possibleDuplicate ? 'Yes' : 'No'],
      ['Possibly billed', safe.possiblyBilled ? 'Yes' : 'No'],
    ])
      fields.append(element('dt', label), element('dd', value));
    detail.append(fields, element('h3', 'Policy versions'));
    if (!safe.policyVersions.length) detail.append(element('p', 'No policy versions recorded.'));
    else {
      const policies = element('ul');
      for (const policy of safe.policyVersions)
        policies.append(element('li', `${policy.id} · ${policy.version}`));
      detail.append(policies);
    }
    detail.append(
      element(
        'p',
        'Recorded metadata only; not invoice reconciliation. Unknown values are not zero.',
      ),
    );
  } catch {
    detail.replaceChildren(element('summary', 'Usage record unavailable.'));
  }
  return detail;
}
