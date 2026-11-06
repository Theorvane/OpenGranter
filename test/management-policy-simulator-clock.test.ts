import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountManagementPolicySimulator } from '../src/management/policy-simulator-app.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const decision = {
  effect: 'Allow',
  reason: 'allowed',
  policyVersions: [{ id: 'private-policy', version: 'v1' }],
} as const;
const flush = async () => {
  for (let i = 0; i < 4; ++i) await new Promise<void>((resolve) => setImmediate(resolve));
};

for (const implementation of ['source', 'artifact'] as const) {
  test(`${implementation}: negative policy simulator clocks erase authority at every read boundary`, async (t) => {
    const mount: typeof mountManagementPolicySimulator =
      implementation === 'source'
        ? mountManagementPolicySimulator
        : (
            await import(
              `data:text/javascript;base64,${Buffer.from(
                await buildManagementBrowser({
                  root: resolve('.'),
                  entry: 'src/management/policy-simulator-app.ts',
                }),
              ).toString('base64')}`
            )
          ).mountManagementPolicySimulator;
    for (const boundary of [
      'connect',
      'submit',
      'complete',
      'timer',
      'timer-pending',
      'schedule-sample',
    ] as const) {
      await t.test(boundary, async () => {
        const root = new TokenElement();
        let time = boundary === 'connect' ? -1 : 100;
        let samples = 0;
        let calls = 0;
        let scheduled = 0;
        let callback: (() => void) | undefined;
        let signal: AbortSignal | undefined;
        let finish: ((result: { state: 'ready'; decision: typeof decision }) => void) | undefined;
        const app = mount(root, {
          now: () => {
            ++samples;
            // connect + expired + delay calculation: reject the delay sample too.
            return boundary === 'schedule-sample' && samples === 3 ? -1 : time;
          },
          schedule: (_delay, next) => {
            ++scheduled;
            callback = next;
            return () => {};
          },
        });
        const reader = (_input: unknown, options: { signal: AbortSignal }) => {
          ++calls;
          signal = options.signal;
          return new Promise<{ state: 'ready'; decision: typeof decision }>((resolve) => {
            finish = resolve;
          });
        };
        try {
          app.connect({ read: reader, expiresAt: 1000 });
          if (boundary !== 'connect' && boundary !== 'schedule-sample') {
            root.named('principalId').value = 'private-principal';
            root.named('action').value = 'llm:InvokeModel';
            root.named('resource').value = 'model:private';
            const staleForm = root.all().find((node) => node.tag === 'form');
            assert.ok(staleForm);
            if (boundary === 'submit') time = -1;
            staleForm.submit();
            if (boundary === 'complete') {
              assert.equal(calls, 1);
              time = -1;
              finish?.({ state: 'ready', decision });
              await flush();
            }
            if (boundary === 'timer' || boundary === 'timer-pending') {
              if (boundary === 'timer') finish?.({ state: 'ready', decision });
              await flush();
              if (boundary === 'timer') assert.match(root.text(), /private-policy/);
              time = -1;
              callback?.();
            }
            assert.equal(calls, boundary === 'submit' ? 0 : 1);
            assert.match(root.text(), /Session expired/);
            if (boundary === 'complete' || boundary === 'timer-pending') {
              assert.equal(signal?.aborted, true);
              finish?.({ state: 'ready', decision });
              await flush();
              assert.match(root.text(), /Session expired/);
            }
            staleForm.submit();
            assert.equal(calls, boundary === 'submit' ? 0 : 1);
          } else {
            assert.equal(scheduled, 0);
            assert.equal(calls, 0);
            assert.match(root.text(), /Session expired/);
          }
          assert.doesNotMatch(root.text(), /private-principal|private-policy|model:private/);
          assert.equal(root.all().filter((node) => node.tag === 'input').length, 0);
          // A healthy clock cannot resurrect the erased host reader.
          time = 0;
          callback?.();
          assert.match(root.text(), /Session expired/);
          const staleTimer = callback;
          app.connect({ read: async () => ({ state: 'missing' }), expiresAt: 1000 });
          assert.match(root.text(), /Enter the exact/);
          staleTimer?.();
          assert.match(root.text(), /Enter the exact/);
        } finally {
          app.dispose();
        }
        assert.equal(root.text(), '');
      });
    }
  });
}
