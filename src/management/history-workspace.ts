import { type AuditReviewSnapshot, createAuditReview } from './audit-review.ts';
import type { CatalogRequest } from './catalog-client.ts';
import { createUsageReview, type UsageReviewSnapshot } from './usage-review.ts';

export interface HistoryWorkspaceSnapshot {
  readonly state: 'active' | 'unauthenticated' | 'denied' | 'disposed';
  readonly usage: UsageReviewSnapshot;
  readonly audit: AuditReviewSnapshot;
}

/** One trusted identity epoch for both histories, not a session authenticator.
 * Dispose on logout/known expiry/identity change; recreate with new authority.
 * Fresh denial in either JSON/CSV transport terminally clears both children.
 */
export function createHistoryWorkspace(
  request: CatalogRequest,
  onChange?: (snapshot: HistoryWorkspaceSnapshot) => void,
) {
  let state: HistoryWorkspaceSnapshot['state'] = 'active';
  let transitioning = false;
  const usage = createUsageReview(sharedRequest, notify);
  const audit = createAuditReview(sharedRequest, notify);

  function snapshot(): HistoryWorkspaceSnapshot {
    return Object.freeze({ state, usage: usage.snapshot(), audit: audit.snapshot() });
  }
  function notify() {
    if (transitioning) return;
    try {
      onChange?.(snapshot());
    } catch {
      // Rendering diagnostics must not interrupt cancellation or data removal.
    }
  }
  function terminate(next: Exclude<HistoryWorkspaceSnapshot['state'], 'active'>) {
    if (state !== 'active') return;
    // Revoke the shared port BEFORE cancellation can invoke reentrant observers.
    state = next;
    transitioning = true;
    try {
      usage.dispose();
      audit.dispose();
    } finally {
      transitioning = false;
    }
    notify();
  }
  async function sharedRequest(...args: Parameters<CatalogRequest>): Promise<Response> {
    if (state !== 'active') throw new Error('History workspace unavailable');
    const response = await request(...args);
    // Aborted/replaced reads are no longer authority-bearing. Their client owns
    // response disposal and late completion suppression, not this shared epoch.
    if (state === 'active' && !args[1].signal?.aborted) {
      if (response.status === 401) terminate('unauthenticated');
      else if (response.status === 403) terminate('denied');
    }
    return response;
  }
  return Object.freeze({
    usage,
    audit,
    snapshot,
    dispose: () => terminate('disposed'),
  });
}
