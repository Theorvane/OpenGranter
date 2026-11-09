import type { AuditHistoryEvent } from '../audit/postgres-audit-history.ts';
import type { UsageElement } from './usage-app.ts';
import { formatUsageTime } from './usage-time.ts';

/** Inspect only a row already accepted by the audit client whole-page projection.
 * Native disclosure needs no extra transport, permission or retained content.
 */
export function renderAuditEventDetails(
  document: UsageElement['ownerDocument'],
  event: AuditHistoryEvent,
): UsageElement {
  const element = (tag: string, text?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const details = element('details');
  const fields = element('dl');
  for (const [label, value] of [
    ['Event ID', event.eventId],
    ['Time UTC', formatUsageTime(event.occurredAt)],
    ['Event kind', event.kind],
    ['Principal', event.principalId],
    ['Request ID', event.requestId],
    ['Credential reference', event.credentialId],
  ] as const)
    fields.append(element('dt', label), element('dd', value));
  const versions = element('ul');
  for (const policy of event.policyVersions) {
    const entry = element('li');
    entry.append(element('span', policy.id), element('span', ` — version ${policy.version}`));
    versions.append(entry);
  }
  const metadata = element('dl');
  for (const [key, value] of Object.entries(event.details)) {
    metadata.append(
      element('dt', key),
      element('dd', typeof value === 'string' ? value : JSON.stringify(value)),
    );
  }
  details.append(
    element('summary', `Inspect audit event ${event.eventId}`),
    fields,
    element('h2', 'Recorded policy versions'),
    event.policyVersions.length ? versions : element('p', 'No policy versions recorded.'),
    element('h2', 'Projected event metadata'),
    Object.keys(event.details).length ? metadata : element('p', 'No event metadata recorded.'),
    element(
      'p',
      'Recorded event evidence only; not a current permission decision. Credential references are identifiers, not token values.',
    ),
  );
  return details;
}
