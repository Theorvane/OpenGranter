import { encodeCsv } from '../export/csv.ts';
import { parseStoredUsageRecord } from './history.ts';

const COLUMNS = [
  'request_id',
  'attempt_id',
  'principal_id',
  'credential_id',
  'policy_versions',
  'model',
  'route_kind',
  'upstream_model',
  'selected_candidate',
  'actual_inference_provider',
  'occurred_at_ms',
  'latency_ms',
  'outcome',
  'possibly_billed',
  'possible_duplicate',
  'usage_status',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'estimated_amount',
  'estimated_currency',
  'price_version',
  'billed_amount',
  'billed_currency',
  'billed_source',
] as const;

/** Export allowlisted metadata; formula-looking text is transformed for initial spreadsheet import. */
export function serializeUsageCsv(records: readonly unknown[]): string {
  const rows = records
    .map(parseStoredUsageRecord)
    .map((record) => [
      record.requestId,
      record.attemptId,
      record.principalId,
      record.credentialId,
      JSON.stringify(record.policyVersions),
      record.modelAlias,
      record.routeKind,
      record.upstreamModelId,
      record.selectedCandidateId,
      record.actualInferenceProviderId,
      record.occurredAt,
      record.latencyMs,
      record.outcome,
      record.possiblyBilled,
      record.possibleDuplicate,
      record.usage.status,
      record.usage.promptTokens,
      record.usage.completionTokens,
      record.usage.totalTokens,
      record.estimatedCost?.amountDecimal,
      record.estimatedCost?.currency,
      record.estimatedCost?.priceVersion,
      record.upstreamBilledCost?.amountDecimal,
      record.upstreamBilledCost?.currency,
      record.upstreamBilledCost?.source,
    ]);
  return encodeCsv(COLUMNS, rows);
}
