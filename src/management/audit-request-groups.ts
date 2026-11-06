import type { AuditHistoryEvent } from '../audit/postgres-audit-history.ts';
import type { UsageElement } from './usage-app.ts';
import { formatUsageTime } from './usage-time.ts';

/** Input must be the client's validated, reprojected authorized page. No authority,
 * transport, raw stored details, cross-page cache or causal inference lives here.
 */
export function renderAuditEventMetadata(
  document: UsageElement['ownerDocument'],
  event: AuditHistoryEvent,
): UsageElement {
  const fields = document.createElement('dl');
  for (const [label, value] of [
    ['Credential ID', event.credentialId],
    ['Policy versions', JSON.stringify(event.policyVersions)],
    ['Allowlisted details', JSON.stringify(event.details)],
  ] as const) {
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent = value;
    fields.append(term, definition);
  }
  return fields;
}

/** Correlate only by exact principal + request ID, preserving returned order and
 * every event (including repeats). Identifiers are not identity or permission.
 */
export function renderAuditRequestGroups(
  document: UsageElement['ownerDocument'],
  events: readonly AuditHistoryEvent[],
): UsageElement {
  const element = (tag: string, text?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const section = element('section');
  section.setAttribute('aria-label', 'Current page audit request correlation');
  section.append(
    element('h2', 'Request correlation — current page only'),
    element(
      'p',
      'These are authorized current-page events, not complete request history. ' +
        'Server page order is preserved; execution order, causality and request success are not inferred. ' +
        'Repeated events are not deduplicated. Expand a request to inspect its events; no additional read is made.',
    ),
  );
  // Nested maps prevent delimiter collisions and never combine different principals.
  const principals = new Map<string, Map<string, AuditHistoryEvent[]>>();
  const groups: AuditHistoryEvent[][] = [];
  for (const event of events) {
    let requests = principals.get(event.principalId);
    if (!requests) {
      requests = new Map();
      principals.set(event.principalId, requests);
    }
    let group = requests.get(event.requestId);
    if (!group) {
      group = [];
      requests.set(event.requestId, group);
      groups.push(group);
    }
    group.push(event);
  }
  for (const group of groups) {
    const first = group[0];
    if (!first) continue;
    const details = element('details');
    details.append(
      element('summary', `Request: ${first.requestId} — Principal: ${first.principalId}`),
      element('p', `Events on this page: ${group.length}`),
    );
    for (const event of group) {
      const item = element('section');
      item.append(
        element('h3', `Event: ${event.eventId}`),
        element('p', `Time (UTC): ${formatUsageTime(event.occurredAt)}`),
        element('p', `Kind: ${event.kind}`),
        renderAuditEventMetadata(document, event),
      );
      details.append(item);
    }
    section.append(details);
  }
  return section;
}
