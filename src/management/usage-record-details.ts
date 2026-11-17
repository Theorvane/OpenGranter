import type { UsageJsonRecord } from '../shared/usage/json.ts';
import type { CatalogElement } from './catalog-view.ts';

/** Inspect already-validated, scoped attempt metadata; no authority or fetch. */
export function appendUsageRecordDetails(root: CatalogElement, row: UsageJsonRecord): void {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const disclosure = element('details');
  disclosure.append(element('summary', 'Inspect usage attempt'));
  const fields = element('dl');
  for (const [label, value] of [
    ['Attempt ID', row.attemptId],
    ['Route kind', row.routeKind],
    ['Recorded upstream target', row.upstreamModelId],
    ['Selected candidate', row.selectedCandidateId ?? 'Unknown'],
    ['Reported inference provider', row.actualInferenceProviderId ?? 'Unknown'],
    ['Outcome', row.outcome],
    ['Latency (ms)', String(row.latencyMs)],
    ['Usage availability', row.usage.status],
    ['Input tokens', String(row.usage.promptTokens ?? 'Unknown')],
    ['Output tokens', String(row.usage.completionTokens ?? 'Unknown')],
    ['Total tokens', String(row.usage.totalTokens ?? 'Unknown')],
  ] as const) {
    fields.append(element('dt', label), element('dd', value));
  }
  disclosure.append(
    fields,
    element(
      'p',
      'One recorded attempt, not a request total. The upstream target is not proof of the actual model served. Unknown provider or token counts are not inferred; a failed attempt may still be billed.',
    ),
  );
  root.append(disclosure);
}
