import { encodeCsv } from '../export/csv.ts';
import { projectAuditHistoryPage } from './history-http.ts';
import type { AuditHistoryPage, AuditHistoryQuery } from './postgres-audit-history.ts';

const COLUMNS = [
  'event_id',
  'occurred_at_ms',
  'kind',
  'request_id',
  'principal_id',
  'credential_id',
  'policy_versions',
  'details',
] as const;

/** Reproject the complete authorized page before exporting metadata. */
export function serializeAuditCsv(
  page: AuditHistoryPage,
  targetPrincipalId: string,
  query: Omit<AuditHistoryQuery, 'principalId'>,
): string {
  const projected = projectAuditHistoryPage(
    page,
    targetPrincipalId,
    query.limit,
    query.cursor ?? null,
    query,
  );
  return encodeCsv(
    COLUMNS,
    projected.events.map((event) => [
      event.eventId,
      event.occurredAt,
      event.kind,
      event.requestId,
      event.principalId,
      event.credentialId,
      JSON.stringify(event.policyVersions),
      JSON.stringify(event.details),
    ]),
  );
}
