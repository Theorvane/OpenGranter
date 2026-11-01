/** Presentation only. A trusted adapter must determine session/permission state. */
export type ManagementBoundaryState =
  | 'loading'
  | 'unauthenticated'
  | 'expired'
  | 'denied'
  | 'unavailable';

const views = {
  loading: ['Checking your session', 'Please wait while your session is checked.', 'status'],
  unauthenticated: [
    'Sign-in required',
    'Sign in through your configured company identity service.',
    'status',
  ],
  expired: ['Session expired', 'Your session has expired. Sign in again to continue.', 'alert'],
  denied: ['Access denied', 'You do not have access to this management view.', 'alert'],
  unavailable: [
    'Management unavailable',
    'The management service is unavailable. Try again later.',
    'alert',
  ],
} as const;

/** Never interpolate caller data, credentials, error details or protected content. */
export function renderManagementBoundaryView(state: unknown): string {
  const { selected, heading, description, role } = boundaryContent(state);
  const live = selected === 'loading' ? ' aria-live="polite"' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenGranter management</title>
</head>
<body>
<main>
<h1>${heading}</h1>
<p role="${role}"${live}>${description}</p>
</main>
</body>
</html>`;
}

function boundaryContent(state: unknown) {
  const selected: ManagementBoundaryState =
    state === 'loading' ||
    state === 'unauthenticated' ||
    state === 'expired' ||
    state === 'denied' ||
    state === 'unavailable'
      ? state
      : 'unavailable';
  const [heading, description, role] = views[selected];
  return { selected, heading, description, role };
}

/** Narrow structural DOM port; compatible with an owned HTMLElement root. */
export interface ManagementBoundaryElement {
  textContent: string | null;
  ownerDocument: { createElement(tag: string): ManagementBoundaryElement };
  setAttribute(name: string, value: string): void;
  append(...nodes: ManagementBoundaryElement[]): void;
  replaceChildren(...nodes: ManagementBoundaryElement[]): void;
}

/** Presentation only: caller selects trusted state and owns resource cleanup. */
export function mountManagementBoundaryView(root: ManagementBoundaryElement, state: unknown): void {
  const { selected, heading, description, role } = boundaryContent(state);
  const main = root.ownerDocument.createElement('main');
  const title = root.ownerDocument.createElement('h1');
  const message = root.ownerDocument.createElement('p');
  title.textContent = heading;
  message.textContent = description;
  message.setAttribute('role', role);
  if (selected === 'loading') message.setAttribute('aria-live', 'polite');
  main.append(title, message);
  root.replaceChildren(main);
}
