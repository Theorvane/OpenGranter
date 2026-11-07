import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-usage-workspace.ts',
});
const built = await import(
  'data:text/javascript;base64,' + Buffer.from(javascript).toString('base64')
);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
for (const [label, mount] of [
  ['source', mountSsoUsageWorkspace],
  ['built', built.mountSsoUsageWorkspace as typeof mountSsoUsageWorkspace],
] as const) {
  for (const format of ['json', 'csv'] as const) {
    for (const phase of ['response', 'body'] as const) {
      for (const clock of ['deadline', 'invalid', 'throwing', 'negative'] as const) {
        test(`${label}: Usage ${format} ${phase} suspended timer with ${clock} clock`, async (t) => {
          const root = new TokenElement();
          let time = 100;
          let throwing = false;
          let reads = 0;
          let complete!: (response: Response) => void;
          let body!: ReadableStreamDefaultController<Uint8Array>;
          const app = mount(root, new EventTarget(), {
            now: () => {
              if (throwing) throw Error('private clock error');
              return time;
            },
            schedule: () => () => {},
          });
          t.after(() => app.dispose());
          const empty = { object: 'list', data: [], has_more: false, next_cursor: null };
          const headers = {
            'content-type': format === 'json' ? 'application/json' : 'text/csv',
            'x-usage-has-more': 'false',
          };
          await app.authorize({
            expiresAt: 200,
            request: async (path) => {
              reads++;
              if (!path.startsWith('/management/v1/usage?'))
                return Response.json({ object: 'list', data: [] });
              if (format === 'csv' && path.includes('format=json')) return Response.json(empty);
              if (phase === 'response')
                return new Promise<Response>((resolve) => {
                  complete = resolve;
                });
              return new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    body = controller;
                  },
                }),
                { headers },
              );
            },
          });
          root.button('Usage history').click();
          await settle();
          if (format === 'csv') {
            root.button('Export current page CSV').click();
            await settle();
          }
          assert.match(root.text(), format === 'json' ? /Loading usage/ : /Preparing CSV page/);
          time = clock === 'invalid' ? NaN : clock === 'negative' ? -1 : 200;
          throwing = clock === 'throwing';
          const payload =
            format === 'json' ? JSON.stringify(empty) : 'model\r\nlate-private-human\r\n';
          if (phase === 'response') complete(new Response(payload, { headers }));
          else {
            body.enqueue(new TextEncoder().encode(payload));
            body.close();
          }
          await settle();
          assert.doesNotMatch(
            root.text(),
            /late-private-human|private clock error|No usage records/,
          );
          assert.match(root.text(), /Session expired/);
          assert.equal(
            root.all().some((node) => node.attrs.download === 'usage.csv'),
            false,
          );
          time = 100;
          throwing = false; // Clock recovery must not resurrect host authority.
          root.button('Credentials').click();
          assert.equal(root.button('Issue token').attrs.disabled, '');
          assert.equal(reads, format === 'json' ? 2 : 3);
        });
      }
    }
  }
}

for (const [label, mount] of [
  ['source', mountSsoUsageWorkspace],
  ['built', built.mountSsoUsageWorkspace as typeof mountSsoUsageWorkspace],
] as const) {
  test(label + ': stale Usage completion cannot clear a renewed workspace grant', async (t) => {
    const root = new TokenElement();
    let time = 100;
    let old = true;
    let complete!: (response: Response) => void;
    const app = mount(root, new EventTarget(), { now: () => time, schedule: () => () => {} });
    t.after(() => app.dispose());
    const request = async (path: string) => {
      if (!path.startsWith('/management/v1/usage?'))
        return Response.json({ object: 'list', data: [] });
      if (old)
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    };
    await app.authorize({ expiresAt: 200, request });
    root.button('Usage history').click();
    await settle();
    old = false;
    await app.authorize({ expiresAt: 400, request });
    root.button('Usage history').click();
    await settle();
    time = 200;
    complete(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
    await settle();
    assert.match(root.text(), /No usage records/);
    assert.doesNotMatch(root.text(), /Session expired/);
    root.button('Credentials').click();
    assert.equal(root.button('Issue token').attrs.disabled, undefined);
  });
}
