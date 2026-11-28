import type { AuditAttribution } from './attribution.ts';

export interface ReservationAuditEvent extends AuditAttribution {
  readonly kind: 'reservation';
  readonly requestId: string;
  readonly modelAlias: string;
  readonly action:
    | 'admitted'
    | 'denied'
    | 'intent'
    | 'handoff'
    | 'completed'
    | 'expired'
    | 'reconciled'
    | 'overrun';
  readonly attemptId?: string;
  readonly evidenceId?: string;
}
