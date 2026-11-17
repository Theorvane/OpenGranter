import assert from 'node:assert/strict';
import test from 'node:test';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { Element, nodes, text, tick } from './account-token-dom-fixture.ts';

function click(root: Element, label: string) {
  const button = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(button, label);
  button.listeners.click?.();
}
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
const csv = () =>
  new Response('header\n', {
    headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
  });

for (const kind of ['usage', 'audit'] as const) {
  const tab = kind === 'usage' ? 'Usage' : 'Audit';
  const other = kind === 'usage' ? 'Audit' : 'Usage';
  test(`${kind}: leaving pending JSON aborts it, discards late denial and refreshes on return`, async () => {
    const root = new Element();
    let blocked = false;
    let signal: AbortSignal | null | undefined;
    let resolve!: (r: Response) => void;
    const paths: string[] = [];
    const app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        paths.push(path);
        if (blocked && path.includes(`/${kind}?`)) {
          blocked = false;
          signal = init.signal;
          return new Promise<Response>((r) => {
            resolve = r;
          });
        }
        return empty();
      },
      { save: () => 'started', dispose() {} },
    );
    try {
      await tick();
      if (kind === 'audit') {
        click(root, tab);
        await tick();
      }
      const principal = nodes(root).find((n) => n.attributes['aria-label'] === 'Principal');
      assert.ok(principal);
      principal.value = 'human';
      click(root, 'Apply filters');
      await tick();
      blocked = true;
      click(root, 'Refresh current page');
      const oldPath = paths.at(-1);
      assert.equal(signal?.aborted, false);
      click(root, tab);
      assert.equal(signal?.aborted, false, 'same tab is not navigation');
      click(root, other);
      assert.equal(signal?.aborted, true, 'outgoing JSON must stop');
      resolve(new Response(null, { status: 403 }));
      await tick();
      assert.doesNotMatch(text(root), /Access denied/);
      click(root, tab);
      await tick();
      assert.equal(paths.at(-1), oldPath, 'return rechecks the retained applied scope');
      assert.match(text(root), /No history matches these filters/);
    } finally {
      app.dispose();
    }
  });

  for (const streaming of [false, true])
    test(`${kind}: tab switch cancels CSV ${streaming ? 'body' : 'headers'} without late save`, async () => {
      const root = new Element();
      let signal: AbortSignal | null | undefined;
      let resolve!: (r: Response) => void;
      let bodyCancelled = false;
      let exports = 0;
      const saves: string[] = [];
      const app = mountHistoryWorkspace(
        root,
        async (path, init) => {
          if (!path.includes('format=csv')) return empty();
          signal = init.signal;
          exports++;
          if (exports > 1) return csv();
          if (!streaming)
            return new Promise<Response>((r) => {
              resolve = r;
            });
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('header\n'));
              },
              cancel() {
                bodyCancelled = true;
              },
            }),
            { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } },
          );
        },
        {
          save: (savedKind) => {
            saves.push(savedKind);
            return 'started';
          },
          dispose() {},
        },
      );
      try {
        await tick();
        if (kind === 'audit') {
          click(root, tab);
          await tick();
        }
        click(root, 'Download current page CSV');
        await tick();
        assert.equal(signal?.aborted, false);
        click(root, other);
        assert.equal(signal?.aborted, true, 'outgoing CSV must stop');
        if (!streaming) resolve(csv());
        await tick();
        assert.equal(bodyCancelled, streaming);
        assert.deepEqual(saves, []);
        click(root, tab);
        await tick();
        click(root, 'Download current page CSV');
        await tick();
        assert.deepEqual(saves, [kind], 'explicit new export remains usable');
      } finally {
        app.dispose();
      }
    });
}

for (const kind of ['usage', 'audit'] as const) {
  test(`${kind}: request-investigation navigation cancels the outgoing export`, async () => {
    const root = new Element();
    let signal: AbortSignal | null | undefined;
    let resolve!: (r: Response) => void;
    let saves = 0;
    const app = mountHistoryWorkspace(
      root,
      async (path, init) => {
        if (path.includes('format=csv')) {
          signal = init.signal;
          return new Promise<Response>((r) => {
            resolve = r;
          });
        }
        const row = path.includes('/audit?')
          ? {
              eventId: '1',
              occurredAt: 100,
              kind: 'models-listed',
              requestId: 'req',
              principalId: 'human',
              credentialId: 'cred',
              policyVersions: [],
              details: { count: 1 },
            }
          : buildUsageRecord({
              principalId: 'human',
              credentialId: 'cred',
              policyVersions: [],
              requestId: 'req',
              attemptId: 'attempt',
              occurredAt: 100,
              modelAlias: 'chat',
              routeKind: 'managed',
              upstreamModelId: 'upstream',
              selectedCandidateId: 'candidate',
              latencyMs: 1,
              outcome: 'succeeded',
              possiblyBilled: false,
              possibleDuplicate: false,
            });
        return Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
      },
      {
        save: () => {
          saves++;
          return 'started';
        },
        dispose() {},
      },
    );
    try {
      await tick();
      if (kind === 'audit') {
        click(root, 'Audit');
        await tick();
      }
      click(root, 'Download current page CSV');
      await tick();
      click(root, kind === 'usage' ? 'View audit for this request' : 'View usage for this request');
      assert.equal(signal?.aborted, true);
      resolve(csv());
      await tick();
      assert.equal(saves, 0);
      assert.ok(
        nodes(root).some(
          (n) => n.tag === 'h2' && n.textContent === (kind === 'usage' ? 'Audit' : 'Usage'),
        ),
      );
    } finally {
      app.dispose();
    }
  });
}

test('tab cancellation never renders cached target rows before its fresh authorization request', async () => {
  class ObservedRoot extends Element {
    observed: string[] = [];
    override replaceChildren(...children: Element[]) {
      super.replaceChildren(...children);
      this.observed.push(text(this));
    }
  }
  const root = new ObservedRoot();
  let usageReads = 0;
  let resolve!: (r: Response) => void;
  const ui = mountHistoryWorkspace(
    root,
    async (path) => {
      if (path.includes('format=csv'))
        return new Promise<Response>((r) => {
          resolve = r;
        });
      if (path.includes('/usage?')) {
        usageReads++;
        if (usageReads > 1)
          return new Promise<Response>((r) => {
            resolve = r;
          });
        const row = buildUsageRecord({
          principalId: 'human',
          credentialId: 'cred',
          policyVersions: [],
          requestId: 'CACHED_USAGE',
          attemptId: 'attempt',
          occurredAt: 100,
          modelAlias: 'chat',
          routeKind: 'managed',
          upstreamModelId: 'upstream',
          selectedCandidateId: 'candidate',
          latencyMs: 1,
          outcome: 'succeeded',
          possiblyBilled: false,
          possibleDuplicate: false,
        });
        return Response.json({ object: 'list', data: [row], has_more: false, next_cursor: null });
      }
      return empty();
    },
    { save: () => 'started', dispose() {} },
  );
  try {
    await tick();
    click(root, 'Audit');
    await tick();
    click(root, 'Download current page CSV');
    const lateCsv = resolve;
    root.observed = [];
    click(root, 'Usage');
    assert.equal(usageReads, 2);
    assert.ok(root.observed.length > 0);
    assert.ok(
      root.observed.every((render) => !render.includes('CACHED_USAGE')),
      'cancellation notification must not render cached destination data',
    );
    lateCsv(csv());
    resolve(empty());
    await tick();
  } finally {
    ui.dispose();
  }
});
