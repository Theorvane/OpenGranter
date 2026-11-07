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
  for (const phase of ['response', 'body'] as const) {
    for (const clock of ['deadline', 'invalid', 'throwing', 'negative'] as const) {
      test(
        label +
          ': Account ' +
          phase +
          ' continuation clears authority with suspended timer and ' +
          clock +
          ' clock',
        async (t) => {
          const root = new TokenElement();
          let time = 100;
          let throwing = false;
          let complete!: (response: Response) => void;
          let body!: ReadableStreamDefaultController<Uint8Array>;
          let aborted: AbortSignal | null | undefined;
          let reads = 0;
          const app = mount(root, new EventTarget(), {
            now: () => {
              if (throwing) throw Error('private clock error');
              return time;
            },
            schedule: () => () => {}, // Browser timers may be suspended; never fire them here.
          });
          t.after(() => app.dispose());
          await app.authorize({
            expiresAt: 200,
            request: async (path, init) => {
              reads++;
              if (!path.endsWith('/me')) return Response.json({ object: 'list', data: [] });
              aborted = init.signal;
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
                {
                  headers: { 'content-type': 'application/json' },
                },
              );
            },
          });
          root.button('Account').click();
          await settle();
          assert.match(root.text(), /Loading current principal/);
          time = clock === 'invalid' ? NaN : clock === 'negative' ? -1 : 200;
          throwing = clock === 'throwing';
          if (phase === 'response') complete(Response.json({ principalId: 'late-private-human' }));
          else {
            body.enqueue(
              new TextEncoder().encode(JSON.stringify({ principalId: 'late-private-human' })),
            );
            body.close();
          }
          await settle();
          assert.doesNotMatch(root.text(), /late-private-human|private clock error/);
          assert.match(root.text(), /Session expired/);
          assert.equal(aborted?.aborted, true);
          root.button('Credentials').click();
          assert.doesNotMatch(root.text(), /Confirm issuance|Issue credential/);
          assert.equal(reads, 2);
        },
      );
    }
  }
}

for (const [label, mount] of [
  ['source', mountSsoUsageWorkspace],
  ['built', built.mountSsoUsageWorkspace as typeof mountSsoUsageWorkspace],
] as const) {
  test(label + ': old Account continuation cannot expire a renewed host grant', async (t) => {
    const root = new TokenElement();
    let time = 100;
    let complete!: (response: Response) => void;
    let old = true;
    const app = mount(root, new EventTarget(), { now: () => time, schedule: () => () => {} });
    t.after(() => app.dispose());
    const request = async (path: string) => {
      if (!path.endsWith('/me')) return Response.json({ object: 'list', data: [] });
      if (old)
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      return Response.json({ principalId: 'renewed-human' });
    };
    await app.authorize({ expiresAt: 200, request });
    root.button('Account').click();
    await settle();
    time = 200;
    old = false;
    await app.authorize({ expiresAt: 400, request });
    complete(Response.json({ principalId: 'old-human' }));
    await settle();
    root.button('Account').click();
    await settle();
    assert.match(root.text(), /Current principal: renewed-human/);
    assert.doesNotMatch(root.text(), /old-human|Session expired/);
  });
}
