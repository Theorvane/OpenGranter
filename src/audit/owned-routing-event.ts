import type { AuditAttribution } from './attribution.ts';

type OwnedRoutingAuditBase = AuditAttribution & {
  readonly requestId: string;
  readonly routeVersion: string;
  readonly modelAlias: string;
};

/** Nonsecret metadata emitted by the opt-in owned core; no runtime activation. */
export type OwnedRoutingAuditEvent = OwnedRoutingAuditBase &
  (
    | { readonly kind: 'owned-selection-started'; readonly candidateIds: readonly string[] }
    | {
        readonly kind: 'owned-selection';
        readonly candidateId: string;
        readonly selection: 'strategy' | 'deterministic-fallback';
        readonly strategy: 'administrator-priority' | 'jev-research' | 'custom';
      }
    | {
        readonly kind: 'owned-denied';
        readonly reason: 'no-candidates' | 'configuration' | 'reservation';
      }
  );
