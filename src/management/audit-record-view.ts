import { projectGatewayAuditEvent } from '../shared/audit/event-projection.ts';
import type { AuditHistoryEvent } from '../shared/audit/history-types.ts';
import type { CatalogElement } from './catalog-view.ts';

/** One already-authorized page row. No fetch, cache, content retention or authority. */
export function renderAuditRecord(root: CatalogElement, row: AuditHistoryEvent): CatalogElement {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const item = element('li');
  const detail = element('details');
  // Never serialize the supplied object: reuse the shared metadata allowlist.
  try {
    if (!/^[1-9][0-9]{0,18}$/u.test(row.eventId) || BigInt(row.eventId) > 9223372036854775807n)
      throw new Error();
    const safe = projectGatewayAuditEvent(
      {
        ...row.details,
        kind: row.kind,
        requestId: row.requestId,
        principalId: row.principalId,
        credentialId: row.credentialId,
        policyVersions: row.policyVersions,
      },
      row.occurredAt,
    );
    detail.append(
      element(
        'summary',
        `${safe.occurredAt} · ${safe.kind} · ${safe.principalId ?? 'Unknown'} · ${safe.requestId}`,
      ),
    );
    const fields = element('dl');
    for (const [label, value] of [
      ['Event ID', row.eventId],
      ['Occurred at (Unix ms)', String(safe.occurredAt)],
      ['Event kind', safe.kind],
      ['Request ID', safe.requestId],
      ['Principal ID', safe.principalId ?? 'Unknown'],
      ['Credential ID', safe.credentialId ?? 'Unknown'],
    ])
      fields.append(element('dt', label), element('dd', value));
    detail.append(fields, element('h3', 'Policy versions'));
    if (!safe.policyVersions?.length) detail.append(element('p', 'No policy versions recorded.'));
    else {
      const policies = element('ul');
      for (const policy of safe.policyVersions)
        policies.append(element('li', `${policy.id} · ${policy.version}`));
      detail.append(policies);
    }
    detail.append(
      element('h3', 'Redacted metadata'),
      element('pre', JSON.stringify(safe.details, null, 2)),
    );
  } catch {
    detail.replaceChildren(element('summary', 'Audit record unavailable.'));
  }
  item.append(detail);
  return item;
}
