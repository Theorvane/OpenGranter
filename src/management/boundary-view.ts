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
  const selected: ManagementBoundaryState =
    state === 'loading' ||
    state === 'unauthenticated' ||
    state === 'expired' ||
    state === 'denied' ||
    state === 'unavailable'
      ? state
      : 'unavailable';
  const [heading, description, role] = views[selected];
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
