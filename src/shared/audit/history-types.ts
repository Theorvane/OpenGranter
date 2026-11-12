export interface AuditHistoryEvent {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly kind: string;
  readonly requestId: string;
  readonly principalId: string;
  readonly credentialId: string;
  readonly policyVersions: readonly { readonly id: string; readonly version: string }[];
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AuditHistoryPage {
  readonly events: readonly AuditHistoryEvent[];
  readonly nextCursor: string | null;
}
