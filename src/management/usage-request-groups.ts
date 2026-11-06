import type { UsageRecord } from '../usage/record-usage.ts';
import type { UsageElement } from './usage-app.ts';
import { renderUsageAttemptDetails } from './usage-attempt-details.ts';
import { formatUsageTime } from './usage-time.ts';

/** Correlation of authorized current-page rows only, not billing reconciliation.
 * No row is removed or reordered and no cross-page completeness is inferred.
 * The ready page owns these nodes; there are no requests or authority here.
 */
export function renderUsageRequestGroups(
  document: UsageElement['ownerDocument'],
  records: readonly UsageRecord[],
): UsageElement {
  const element = (tag: string, text?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const section = element('section');
  section.setAttribute('aria-label', 'Current page request correlation');
  section.append(
    element('h2', 'Request correlation — current page only'),
    element(
      'p',
      'These are current-page records, not complete request history or reconciled billing. ' +
        'Page order is preserved; retry order is not inferred. Repeated records are not deduplicated.',
    ),
  );
  // A nested map avoids delimiter collisions and never combines principals
  // merely because they used the same (untrusted, non-authorizing) request ID.
  const principals = new Map<string, Map<string, UsageRecord[]>>();
  const groups: UsageRecord[][] = [];
  for (const record of records) {
    let requests = principals.get(record.principalId);
    if (!requests) {
      requests = new Map();
      principals.set(record.principalId, requests);
    }
    let group = requests.get(record.requestId);
    if (!group) {
      group = [];
      requests.set(record.requestId, group);
      groups.push(group);
    }
    group.push(record);
  }
  for (const group of groups) {
    const first = group[0];
    if (!first) continue;
    const details = element('details');
    details.append(
      element('summary', 'Request: ' + first.requestId + ' — Principal: ' + first.principalId),
      element(
        'p',
        'Records on this page: ' +
          group.length +
          '; distinct attempt IDs: ' +
          new Set(group.map((row) => row.attemptId)).size,
      ),
    );
    for (const record of group) {
      const attempt = element('section');
      attempt.append(element('h3', 'Attempt: ' + record.attemptId));
      for (const line of [
        'Time (UTC): ' + formatUsageTime(record.occurredAt),
        'Model: ' + record.modelAlias,
        'Outcome: ' + record.outcome,
        'Usage status: ' + record.usage.status,
        'Possibly billed: ' + (record.possiblyBilled ? 'Yes' : 'No'),
        'Server-marked possible duplicate: ' + (record.possibleDuplicate ? 'Yes' : 'No'),
      ])
        attempt.append(element('p', line));
      attempt.append(renderUsageAttemptDetails(document, record));
      details.append(attempt);
    }
    section.append(details);
  }
  return section;
}
