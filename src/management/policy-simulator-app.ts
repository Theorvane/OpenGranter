import type { AttachmentDecision } from '../policy/evaluate-attachments.ts';
import type { PolicySimulationInput } from '../policy/postgres-policy-simulator.ts';
import type { UsageAuthorityOptions, UsageElement } from './usage-app.ts';

export type PolicySimulationResult =
  | { readonly state: 'ready'; readonly decision: AttachmentDecision }
  | { readonly state: 'missing' | 'denied' | 'unauthenticated' | 'unavailable' };
/** Server adapter must authorize, scope and durably audit each read. Not an HTTP API. */
export type PolicySimulationReader = (
  input: PolicySimulationInput,
  options: { readonly signal: AbortSignal },
) => Promise<PolicySimulationResult>;

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    Array.from(value).every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
  );
}
function project(value: unknown): AttachmentDecision | undefined {
  if (typeof value !== 'object' || value === null) return;
  const result = value as AttachmentDecision;
  if (
    !(
      (result.effect === 'Allow' && result.reason === 'allowed') ||
      (result.effect === 'Deny' &&
        ['inactive', 'explicit-deny', 'implicit-deny', 'unresolved-attachment'].includes(
          result.reason,
        ))
    ) ||
    !Array.isArray(result.policyVersions) ||
    result.policyVersions.length > 1024
  )
    return;
  const ids = new Set<string>();
  const policyVersions = [];
  for (const policy of result.policyVersions) {
    if (!policy || !text(policy.id, 256) || !text(policy.version, 256) || ids.has(policy.id))
      return;
    ids.add(policy.id);
    policyVersions.push({ id: policy.id, version: policy.version });
  }
  if (['inactive', 'unresolved-attachment'].includes(result.reason) && policyVersions.length)
    return;
  return { effect: result.effect, reason: result.reason, policyVersions };
}

/** Disconnected source screen: no public mount, endpoint, token, cookie or grant.
 * Host owns reader authorization and clear on permission/logout/page lifecycle.
 * A local deadline only limits display; it cannot authorize a server operation.
 */
export function mountManagementPolicySimulator(
  root: UsageElement,
  options: Pick<UsageAuthorityOptions, 'now' | 'schedule'> = {},
) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay: number, callback: () => void) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let read: PolicySimulationReader | undefined;
  let deadline: number | undefined;
  let stopTimer: (() => void) | undefined;
  let controller: AbortController | undefined;
  let revision = 0;
  let authorityRevision = 0;
  let rendered = 0;
  let disposed = false;
  let state = 'unauthenticated';
  let decision: AttachmentDecision | undefined;
  let evaluated: PolicySimulationInput | undefined;
  let draft = { principalId: '', action: '', resource: '' };
  const element = (tag: string, content?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (content !== undefined) node.textContent = content;
    return node;
  };
  function interrupt() {
    ++revision;
    const pending = controller;
    controller = undefined;
    pending?.abort();
    decision = undefined;
    evaluated = undefined;
  }
  function clear(reason: 'unauthenticated' | 'denied' | 'expired' = 'unauthenticated') {
    if (disposed) return;
    ++authorityRevision;
    read = undefined;
    deadline = undefined;
    const cancel = stopTimer;
    stopTimer = undefined;
    interrupt();
    draft = { principalId: '', action: '', resource: '' };
    state = reason;
    try {
      cancel?.();
    } catch {
      /* Cleanup failure cannot restore reader or result. */
    }
    render();
  }
  function currentTime() {
    try {
      const time = now();
      // An impossible epoch cannot prove the host reader is still valid.
      return Number.isFinite(time) && time >= 0 ? time : Number.NaN;
    } catch {
      return Number.NaN;
    }
  }
  function expired() {
    if (deadline === undefined) return false;
    const time = currentTime();
    if (!Number.isFinite(time) || time >= deadline) {
      clear('expired');
      return true;
    }
    return false;
  }
  function arm() {
    if (!read || deadline === undefined || expired()) return;
    const generation = authorityRevision;
    const time = currentTime();
    if (!Number.isFinite(time) || time >= deadline) {
      clear('expired');
      return;
    }
    const delay = Math.max(1, Math.min(2147483647, deadline - time));
    stopTimer = schedule(delay, () => {
      if (disposed || generation !== authorityRevision) return;
      stopTimer = undefined;
      if (!read || expired()) return;
      try {
        arm();
      } catch {
        clear('expired');
      }
    });
  }
  function render() {
    if (disposed) return;
    const version = ++rendered;
    const section = element('section');
    section.append(
      element('h1', 'Policy simulator'),
      element(
        'p',
        'IAM diagnostic only: Allow is not permission to execute a request. Catalog, limits and provider checks are not simulated.',
      ),
    );
    const messages: Record<string, string> = {
      unauthenticated: 'Sign-in required.',
      denied: 'Access denied.',
      expired: 'Session expired. Sign in again.',
      idle: 'Enter the exact principal, action and resource.',
      loading: 'Evaluating current persisted policy…',
      missing: 'Principal not found.',
      invalid: 'Invalid simulation input.',
      unavailable: 'Simulation unavailable. Try again later.',
      cancelled: 'Simulation cancelled.',
    };
    const message = element('p', state === 'ready' ? 'Simulation complete.' : messages[state]);
    message.setAttribute(
      'role',
      ['idle', 'ready', 'loading', 'missing', 'cancelled'].includes(state) ? 'status' : 'alert',
    );
    section.append(message);
    if (read) {
      const form = element('form');
      form.setAttribute('aria-label', 'Policy simulation');
      form.setAttribute('autocomplete', 'off');
      form.setAttribute('novalidate', '');
      const inputs = {} as Record<keyof PolicySimulationInput, UsageElement>;
      for (const [key, label, maximum] of [
        ['principalId', 'Principal ID', 256],
        ['action', 'Action', 512],
        ['resource', 'Resource', 512],
      ] as const) {
        const wrapper = element('label', label);
        const input = element('input');
        input.setAttribute('name', key);
        input.setAttribute('type', 'text');
        input.setAttribute('maxlength', String(maximum));
        input.setAttribute('required', '');
        input.value = draft[key];
        if (state === 'loading') input.setAttribute('disabled', '');
        wrapper.append(input);
        form.append(wrapper);
        inputs[key] = input;
      }
      const submit = element('button', 'Simulate');
      submit.setAttribute('type', 'submit');
      if (state === 'loading') submit.setAttribute('disabled', '');
      form.append(submit);
      form.addEventListener('submit', (event) => {
        event?.preventDefault();
        if (disposed || version !== rendered || !read || state === 'loading' || expired()) return;
        draft = {
          principalId: inputs.principalId.value ?? '',
          action: inputs.action.value ?? '',
          resource: inputs.resource.value ?? '',
        };
        void run();
      });
      section.append(form);
      if (state === 'loading') {
        const cancel = element('button', 'Cancel');
        cancel.setAttribute('type', 'button');
        cancel.addEventListener('click', () => {
          if (disposed || version !== rendered || expired()) return;
          interrupt();
          state = 'cancelled';
          render();
        });
        section.append(cancel);
      }
    }
    if (decision && evaluated) {
      section.append(
        element(
          'p',
          `Principal: ${evaluated.principalId}; Action: ${evaluated.action}; Resource: ${evaluated.resource}`,
        ),
      );
      section.append(element('h2', `${decision.effect}: ${decision.reason}`));
      const versions = element('ul');
      versions.setAttribute('aria-label', 'Evaluated policy versions');
      for (const policy of decision.policyVersions)
        versions.append(element('li', `${policy.id} — ${policy.version}`));
      section.append(versions);
      if (!decision.policyVersions.length)
        section.append(element('p', 'No evaluated policy versions.'));
    }
    root.replaceChildren(section);
  }
  async function run() {
    if (!read || expired()) return;
    interrupt();
    if (!text(draft.principalId, 256) || !text(draft.action, 512) || !text(draft.resource, 512)) {
      state = 'invalid';
      render();
      return;
    }
    const reader = read;
    const input = Object.freeze({ ...draft });
    const operation = revision;
    const pending = new AbortController();
    controller = pending;
    state = 'loading';
    render();
    try {
      const result = await reader(input, { signal: pending.signal });
      if (disposed || operation !== revision || pending.signal.aborted || expired()) return;
      controller = undefined;
      if (result.state === 'denied' || result.state === 'unauthenticated') {
        clear(result.state);
        return;
      }
      if (result.state === 'ready') {
        decision = project(result.decision);
        state = decision ? 'ready' : 'unavailable';
        if (decision) evaluated = input;
      } else state = result.state === 'missing' ? 'missing' : 'unavailable';
    } catch {
      if (disposed || operation !== revision || pending.signal.aborted || expired()) return;
      controller = undefined;
      state = 'unavailable';
    }
    render();
  }
  render();
  return {
    connect(grant: { readonly read: PolicySimulationReader; readonly expiresAt: number }) {
      if (disposed) return;
      clear();
      const time = currentTime();
      if (
        !grant ||
        typeof grant.read !== 'function' ||
        !Number.isFinite(time) ||
        !Number.isSafeInteger(grant.expiresAt) ||
        grant.expiresAt <= time
      ) {
        clear('expired');
        return;
      }
      read = grant.read;
      deadline = grant.expiresAt;
      state = 'idle';
      try {
        arm();
      } catch {
        clear('expired');
        return;
      }
      render();
    },
    clear,
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      ++rendered;
      root.replaceChildren();
    },
  };
}
