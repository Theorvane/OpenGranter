import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import type { UsageElement } from './usage-app.ts';

/** Current active-human identity only, never an IAM grant or a browser session.
 * The host owns trusted authority, expiry and teardown. No automatic retry.
 */
export function mountManagementPrincipal(
  root: UsageElement,
  options: { readonly onRetry?: () => void; readonly context?: 'audit' } = {},
) {
  let disposed = false;
  let revision = 0;
  let pending: AbortController | undefined;
  let rendered = 0;
  function cancel() {
    revision++;
    pending?.abort();
    pending = undefined;
  }
  function render(message: string) {
    const currentRender = ++rendered;
    const heading = root.ownerDocument.createElement('h1');
    heading.textContent = options.context === 'audit' ? 'Audit' : 'Account';
    const status = root.ownerDocument.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = message;
    const warning = root.ownerDocument.createElement('p');
    warning.textContent = 'Identity is not permission to administer resources.';
    root.replaceChildren(heading, status);
    if (options.context !== 'audit') root.append(warning);
    if (message === 'Current principal unavailable.' && options.onRetry) {
      const retry = root.ownerDocument.createElement('button');
      retry.setAttribute('type', 'button');
      retry.textContent = 'Retry current principal';
      retry.addEventListener('click', () => {
        if (disposed || currentRender !== rendered) return;
        // Consume once before calling the host; it owns fresh expiry/lifecycle checks.
        rendered++;
        options.onRetry?.();
      });
      root.append(retry);
    }
  }
  function clear(reason: 'unauthenticated' | 'expired' | 'denied' = 'unauthenticated') {
    if (disposed) return;
    cancel();
    render(
      reason === 'expired'
        ? 'Session expired.'
        : reason === 'denied'
          ? 'Access denied.'
          : 'Sign-in required.',
    );
  }
  clear();
  return {
    clear,
    async authorize(grant: CatalogAuthorityGrant) {
      if (disposed) return;
      cancel();
      const current = revision;
      const controller = new AbortController();
      pending = controller;
      const live = () => !disposed && revision === current && !controller.signal.aborted;
      const discard = (response: Response) => {
        try {
          void response.body?.cancel().catch(() => {});
        } catch {
          /* Best effort. */
        }
      };
      render('Loading current principal…');
      // Deadline settles even if a transport or response reader ignores cancellation.
      const timer = setTimeout(() => {
        if (!live()) return;
        render('Current principal unavailable.');
        cancel();
      }, 30_000);
      const interrupted = new Promise<string | undefined>((resolve) =>
        controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
      );
      const operation = async () => {
        try {
          const response = await grant.request('/management/v1/me', {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          });
          if (!live()) {
            discard(response);
            return;
          }
          if (response.status !== 200) {
            discard(response);
            render(
              response.status === 401
                ? 'Sign-in required.'
                : response.status === 403
                  ? 'Access denied.'
                  : 'Current principal unavailable.',
            );
            return;
          }
          const length = response.headers.get('content-length');
          if (
            response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
              'application/json' ||
            (length !== null && /^\d+$/u.test(length) && Number(length) > 4096) ||
            !response.body
          ) {
            discard(response);
            throw Error('Invalid response');
          }
          const reader = response.body.getReader();
          const abort = () => {
            try {
              void reader.cancel().catch(() => {});
            } catch {
              /* Best effort. */
            }
          };
          controller.signal.addEventListener('abort', abort, { once: true });
          const bytes = new Uint8Array(4096);
          let size = 0;
          let principalId: unknown;
          try {
            while (live()) {
              const chunk = await reader.read();
              if (!live()) return;
              if (chunk.done) break;
              if (size + chunk.value.byteLength > bytes.length) throw Error('Response limit');
              bytes.set(chunk.value, size);
              size += chunk.value.byteLength;
            }
            const body: unknown = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
            );
            if (typeof body !== 'object' || body === null || Array.isArray(body))
              throw Error('Invalid identity');
            principalId = (body as Record<string, unknown>).principalId;
            if (
              Object.keys(body).length !== 1 ||
              typeof principalId !== 'string' ||
              !principalId ||
              principalId.length > 256 ||
              principalId.includes('\0') ||
              /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
                principalId,
              )
            )
              throw Error('Invalid identity');
          } catch (error) {
            abort();
            throw error;
          } finally {
            bytes.fill(0);
            controller.signal.removeEventListener('abort', abort);
            reader.releaseLock();
          }
          if (live()) {
            render(`Current principal: ${principalId}`);
            return principalId;
          }
        } catch {
          if (live()) render('Current principal unavailable.');
        }
      };
      try {
        return await Promise.race([operation(), interrupted]);
      } finally {
        clearTimeout(timer);
        if (current === revision) pending = undefined;
      }
    },
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      root.replaceChildren();
    },
  };
}
