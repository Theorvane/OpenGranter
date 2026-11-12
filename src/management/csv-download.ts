/** Narrow browser ports; no global document, session, network or storage access. */
export interface CsvDownloadAnchor {
  setAttribute(name: string, value: string): void;
  click(): void;
  remove(): void;
}
export interface CsvDownloadPorts<Anchor extends CsvDownloadAnchor> {
  readonly document: {
    createElement(tag: 'a'): Anchor;
    readonly body: { append(anchor: Anchor): void };
  };
  readonly urls: {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
  };
  /** Schedule after the click has been processed; return a cancellation function.
   * A browser caller can wrap setTimeout/clearTimeout. Must not retain CSV bytes.
   */
  readonly deferCleanup: (cleanup: () => void) => () => void;
}
export type CsvDownloadResult = 'started' | 'invalid' | 'unavailable' | 'disposed';

interface DownloadLease<Anchor extends CsvDownloadAnchor> {
  readonly url: string;
  anchor?: Anchor;
  cancel?: () => void;
  released: boolean;
}

/** Explicit one-page save only. Feed already-authorized server CSV unchanged.
 * Dispose together with the identity epoch. A completed external download cannot
 * be erased; started does not assert browser/file-system completion.
 */
export function createCsvDownload<Anchor extends CsvDownloadAnchor>(
  ports: CsvDownloadPorts<Anchor>,
) {
  let disposed = false;
  const pending = new Set<DownloadLease<Anchor>>();
  function safely(operation: () => void) {
    try {
      operation();
    } catch {
      // Browser teardown is best-effort; never expose CSV or raw port errors.
    }
  }
  function release(lease: DownloadLease<Anchor>) {
    if (lease.released) return;
    lease.released = true;
    pending.delete(lease);
    if (lease.cancel) safely(lease.cancel);
    if (lease.anchor) safely(() => lease.anchor?.remove());
    safely(() => ports.urls.revokeObjectURL(lease.url));
    delete lease.cancel;
    delete lease.anchor;
  }
  function save(kind: unknown, csv: unknown): CsvDownloadResult {
    if (disposed) return 'disposed';
    if ((kind !== 'usage' && kind !== 'audit') || typeof csv !== 'string') return 'invalid';
    if (csv.length > 2 * 1024 * 1024) return 'invalid';
    let lease: DownloadLease<Anchor> | undefined;
    try {
      // Blob.size counts UTF-8 bytes, not UTF-16 code units. No BOM/rewriting.
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      if (blob.size > 2 * 1024 * 1024) return 'invalid';
      lease = { url: ports.urls.createObjectURL(blob), released: false };
      pending.add(lease);
      if (disposed) {
        release(lease);
        return 'disposed';
      }
      const anchor = ports.document.createElement('a');
      lease.anchor = anchor;
      if (disposed) {
        // Disposal may have released the URL while createElement was running.
        safely(() => anchor.remove());
        return 'disposed';
      }
      anchor.setAttribute('href', lease.url);
      anchor.setAttribute('download', `opengranter-${kind}-page.csv`);
      anchor.setAttribute('hidden', '');
      anchor.setAttribute('rel', 'noopener');
      if (disposed) return 'disposed';
      ports.document.body.append(anchor);
      if (disposed) {
        safely(() => anchor.remove());
        return 'disposed';
      }
      anchor.click();
      anchor.remove();
      delete lease.anchor;
      if (!lease.released) {
        const current = lease;
        const cancel = ports.deferCleanup(() => release(current));
        // Handle synchronous cleanup/disposal inside an injected scheduling port.
        if (lease.released) safely(cancel);
        else lease.cancel = cancel;
      }
      return 'started';
    } catch {
      if (lease) release(lease);
      return disposed ? 'disposed' : 'unavailable';
    }
  }
  return Object.freeze({
    save,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const lease of [...pending]) release(lease);
    },
  });
}
