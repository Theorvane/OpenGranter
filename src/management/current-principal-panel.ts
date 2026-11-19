import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { createCurrentPrincipalClient } from './current-principal-client.ts';

/** Display only. Trusted caller must dispose on logout, expiry or identity change.
 * Does not create a session, obtain credentials, infer permissions or activate UI.
 */
export function mountCurrentPrincipalPanel(root: CatalogElement, request: CatalogRequest) {
  const client = createCurrentPrincipalClient(request);
  let epoch = 0;
  let stopped = false;
  function element(tag: string, label: string) {
    const node = root.ownerDocument.createElement(tag);
    node.textContent = label;
    return node;
  }
  async function read() {
    if (stopped) return;
    const current = ++epoch;
    client.invalidate();
    const section = element('section', '');
    section.setAttribute('aria-label', 'Account');
    section.setAttribute('aria-busy', 'true');
    const heading = element('h1', 'Account');
    const status = element('p', 'Loading account…');
    status.setAttribute('role', 'status');
    section.append(heading, status);
    root.replaceChildren(section);
    const result = await client.read();
    if (stopped || current !== epoch) return;
    section.setAttribute('aria-busy', 'false');
    function action(label: string) {
      const button = element('button', label);
      button.setAttribute('type', 'button');
      button.addEventListener('click', () => {
        if (!stopped && current === epoch) void read();
      });
      return button;
    }
    if (result.state === 'ready') {
      const identity = element('dl', '');
      identity.append(
        element('dt', 'Principal ID'),
        element('dd', result.data.id),
        element('dt', 'Principal kind'),
        element('dd', result.data.kind),
      );
      section.replaceChildren(heading, identity, action('Refresh account'));
    } else if (result.state === 'unauthenticated' || result.state === 'denied') {
      stopped = true;
      client.invalidate();
      const message = element(
        'p',
        result.state === 'unauthenticated' ? 'Sign in required.' : 'Access denied.',
      );
      message.setAttribute('role', 'alert');
      section.replaceChildren(heading, message);
    } else {
      const message = element('p', 'Account unavailable. Try again.');
      message.setAttribute('role', 'alert');
      section.replaceChildren(heading, message, action('Retry account'));
    }
  }
  void read();
  return Object.freeze({
    dispose() {
      stopped = true;
      ++epoch;
      client.invalidate();
      root.replaceChildren();
    },
  });
}
