import type { UsageRecord } from '../usage/record-usage.ts';
import type { UsageElement } from './usage-app.ts';
import { renderUsagePageSummary } from './usage-page-summary.ts';

/** Exact alias groups of already authorized page rows, never a new read or scope. */
export function renderUsageModelSummary(
  document: UsageElement['ownerDocument'],
  records: readonly UsageRecord[],
  filterControl?: (alias: string) => UsageElement,
): UsageElement {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Current page usage by model');
  const heading = document.createElement('h2');
  heading.textContent = 'Usage by model — current page only';
  const caveat = document.createElement('p');
  caveat.textContent =
    'Expand a model to inspect costs and known token counters from this page only. ' +
    'Not all-pages totals, settled billing or reconciliation; duplicate rows remain included.';
  section.append(heading, caveat);
  const groups = new Map<string, UsageRecord[]>();
  for (const row of records) {
    const group = groups.get(row.modelAlias);
    if (group) group.push(row);
    else groups.set(row.modelAlias, [row]);
  }
  if (groups.size === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No model usage on this page.';
    section.append(empty);
  }
  for (const [alias, rows] of groups) {
    const details = document.createElement('details');
    const label = document.createElement('summary');
    label.textContent = alias;
    const summary = renderUsagePageSummary(document, rows);
    summary.setAttribute('aria-label', 'Current page cost and token summary for ' + alias);
    details.append(label, summary);
    if (filterControl) details.append(filterControl(alias));
    section.append(details);
  }
  return section;
}
