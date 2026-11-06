import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountManagementAudit } from '../src/management/audit-app.ts';
import { mountManagementUsage, type UsageElement } from '../src/management/usage-app.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, (event?: { preventDefault(): void }) => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  addEventListener(type: string, listener: (event?: { preventDefault(): void }) => void) {
    this.listeners[type] = listener;
  }
  click() {
    this.listeners.click?.();
  }
  focus() {}
  all(): Element[] {
    return [this, ...this.children.flatMap((node) => node.all())];
  }
  text(): string {
    return this.all()
      .map((node) => node.textContent ?? '')
      .join(' ');
  }
  button(text: string) {
    const found = this.all().find((node) => node.tag === 'button' && node.textContent === text);
    assert.ok(found, text);
    return found;
  }
}

const record = buildUsageRecord({
  principalId: 'protected-human',
  credentialId: 'credential',
  policyVersions: [],
  requestId: 'request',
  attemptId: 'attempt',
  modelAlias: 'protected-model',
  routeKind: 'managed',
  upstreamModelId: 'model',
  selectedCandidateId: 'candidate',
  occurredAt: 2,
  latencyMs: 10,
  outcome: 'succeeded',
  possiblyBilled: false,
  possibleDuplicate: false,
});
const event = {
  eventId: '8',
  occurredAt: 1000,
  kind: 'models-listed',
  requestId: 'request',
  principalId: 'protected-human',
  credentialId: 'credential',
  policyVersions: [],
  details: { count: 1 },
};
const response = (kind: string) =>
  Response.json({
    object: 'list',
    data: [kind === 'usage' ? record : event],
    has_more: false,
    next_cursor: null,
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

for (const kind of ['usage', 'audit'] as const) {
  for (const artifact of [false, true]) {
    const getMount = async (): Promise<typeof mountManagementUsage> =>
      artifact
        ? (
            await import(
              'data:text/javascript;base64,' +
                Buffer.from(
                  await buildManagementBrowser({
                    root: process.cwd(),
                    entry: `src/management/${kind}-app.ts`,
                  }),
                ).toString('base64')
            )
          )[kind === 'usage' ? 'mountManagementUsage' : 'mountManagementAudit']
        : kind === 'usage'
          ? mountManagementUsage
          : mountManagementAudit;
    for (const fault of ['throw', 'negative', 'nonfinite'] as const) {
      const badClock = () => {
        if (fault === 'throw') throw new Error('PRIVATE_CLOCK_FAILURE');
        return fault === 'negative' ? -1 : NaN;
      };
      test(`${kind} ${artifact ? 'artifact' : 'source'} initial ${fault} clock fails closed`, async () => {
        const root = new Element();
        const app = (await getMount())(root, { now: badClock, schedule: () => () => {} });
        let requests = 0;
        await app.authorize({
          expiresAt: 200,
          request: async () => {
            requests++;
            return response(kind);
          },
        });
        assert.equal(requests, 0);
        assert.match(root.text(), /Session expired/);
        assert.doesNotMatch(root.text(), /PRIVATE|protected-human/);
        app.dispose();
      });
    }
    test(kind + ' ' + artifact + ' delay clock failure never schedules or dispatches', async () => {
      let samples = 0;
      let schedules = 0;
      let requests = 0;
      const root = new Element();
      const app = (await getMount())(root, {
        now: () => {
          if (++samples === 3) throw new Error('PRIVATE_DELAY_CLOCK');
          return 100;
        },
        schedule: () => {
          schedules++;
          return () => {};
        },
      });
      await app.authorize({
        expiresAt: 200,
        request: async () => {
          requests++;
          return response(kind);
        },
      });
      assert.equal(samples, 3);
      assert.equal(schedules, 0);
      assert.equal(requests, 0);
      assert.match(root.text(), /Session expired/);
      app.dispose();
    });
    for (const trigger of ['timer', 'refresh', 'download', 'completion'] as const) {
      test(`${kind} ${artifact ? 'artifact' : 'source'} clock exception at ${trigger} erases protected state`, async () => {
        const root = new Element();
        let broken = false;
        let timer: (() => void) | undefined;
        let requests = 0;
        let pending: ((response: Response) => void) | undefined;
        const app = (await getMount())(root, {
          now: () => {
            if (broken) throw new Error('PRIVATE_CLOCK_FAILURE');
            return 100;
          },
          schedule: (_delay, callback) => {
            timer = callback;
            return () => {};
          },
        });
        const loading = app.authorize({
          expiresAt: 200,
          request: async (path) => {
            requests++;
            if (trigger === 'completion')
              return new Promise<Response>((resolve) => {
                pending = resolve;
              });
            return path.includes('format=csv')
              ? new Response('id\r\n8\r\n', {
                  headers: {
                    'content-type': 'text/csv',
                    [kind === 'usage' ? 'x-usage-has-more' : 'x-has-more']: 'false',
                  },
                })
              : response(kind);
          },
        });
        if (trigger !== 'completion') await loading;
        if (trigger !== 'completion') assert.match(root.text(), /protected-human/);
        let href: string | undefined;
        let anchor: Element | undefined;
        if (trigger === 'download') {
          root.button('Export current page CSV').click();
          await settle();
          anchor = root.all().find((node) => node.tag === 'a');
          assert.ok(anchor);
          href = anchor.attrs.href;
          assert.ok(href);
          assert.equal((await fetch(href)).status, 200);
        }
        const detached = trigger === 'completion' ? undefined : root.button('Refresh current page');
        const count = requests;
        broken = true;
        if (trigger === 'timer') {
          assert.ok(timer);
          assert.doesNotThrow(timer);
        }
        if (trigger === 'refresh')
          assert.doesNotThrow(() => root.button('Refresh current page').click());
        if (trigger === 'download') {
          let prevented = false;
          assert.doesNotThrow(() =>
            anchor?.listeners.click?.({
              preventDefault() {
                prevented = true;
              },
            }),
          );
          assert.equal(prevented, true);
        }
        if (trigger === 'completion') {
          assert.ok(pending);
          pending(response(kind));
          await loading;
        }
        await settle();
        assert.equal(requests, count);
        assert.match(root.text(), /Session expired/);
        assert.doesNotMatch(root.text(), /protected-human|PRIVATE/);
        assert.equal(
          root.all().some((node) => node.tag === 'a'),
          false,
        );
        if (href) await assert.rejects(fetch(href));
        broken = false;
        detached?.click();
        await settle();
        assert.equal(requests, count);
        await app.authorize({
          expiresAt: 200,
          request: async () => {
            requests++;
            return response(kind);
          },
        });
        assert.equal(requests, count + 1);
        assert.match(root.text(), /protected-human/);
        app.dispose();
      });
    }
  }
}
