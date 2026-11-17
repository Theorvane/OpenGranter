import type { AuditHistoryEvent } from '../shared/audit/history-types.ts';
import type { CatalogElement } from './catalog-view.ts';

/** Display an explicit subset of an already-validated scoped metadata event. */
export function appendAuditRecordDetails(root: CatalogElement, row: AuditHistoryEvent): void {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const disclosure = element('details');
  disclosure.append(element('summary', 'Inspect audit event'));
  const fields = element('dl');
  fields.append(element('dt', 'Event ID'), element('dd', row.eventId));
  for (const [label, key] of [
    ['Model', 'modelAlias'],
    ['Route version', 'routeVersion'],
    ['Selected candidate', 'candidateId'],
    ['Attempt ID', 'attemptId'],
    ['Recorded upstream target', 'upstreamModelId'],
    ['Outcome', 'outcome'],
    ['Failure category', 'failureCategory'],
    ['Denial reason', 'reason'],
    ['Possibly billed', 'possiblyBilled'],
    ['Upstream completed', 'upstreamCompleted'],
    ['Count', 'count'],
    ['Target principal', 'targetPrincipalId'],
    ['Read mode', 'mode'],
  ] as const) {
    const value = row.details[key];
    const text =
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        ? String(value)
        : 'Unknown';
    fields.append(element('dt', label), element('dd', text));
  }
  disclosure.append(
    fields,
    element(
      'p',
      'Scoped operational metadata only, not prompt or response content. Unknown fields are not inferred. A recorded upstream target is not proof of the actual model served; possibly billed is not an invoice reconciliation.',
    ),
  );
  root.append(disclosure);
}
