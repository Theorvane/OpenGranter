import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import * as source from '../src/management/catalog-authority.ts';

const javascript = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/catalog-authority.ts',
});
const artifact = (await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
)) as typeof source;
for (const [label, module] of [
  ['source', source],
  ['artifact', artifact],
] as const) {
  for (const [kind, create] of [
    ['proxy', module.createManagementCatalogAuthority],
    ['sso', module.createSsoManagementCatalogAuthority],
  ] as const) {
    test(`${label}/${kind}: clock failure clears already displayed private model data`, async () => {
      for (const failure of ['throw', 'negative'] as const) {
        let failed = false;
        let calls = 0;
        const states: string[] = [];
        const authority = create({
          now: () => {
            if (failed) {
              if (failure === 'throw') throw Error('private clock');
              return -1;
            }
            return 1;
          },
          schedule: () => () => {},
          onChange: (value) => states.push(value.state),
        });
        authority.authorize({
          expiresAt: 100,
          request: async () => {
            calls++;
            return Response.json({
              data: [{ id: 'private/model', object: 'model', created: 0, owned_by: 'opengranter' }],
            });
          },
        });
        await authority.list();
        assert.equal(authority.snapshot().state, 'list');
        failed = true;
        assert.deepEqual(authority.snapshot(), { state: 'expired' });
        assert.equal(states.at(-1), 'expired');
        await authority.list();
        assert.equal(calls, 1);
        authority.dispose();
      }
    });
    test(`${label}/${kind}: invalid initial clock and negative epoch grant never dispatch`, async () => {
      for (const [now, expiresAt] of [
        [
          () => {
            throw Error('private');
          },
          100,
        ],
        [() => -10, -1],
        [() => -10, 100],
      ] as const) {
        let calls = 0;
        const authority = create({ now, schedule: () => () => {}, onChange: () => {} });
        authority.authorize({
          expiresAt,
          request: async () => {
            calls++;
            return Response.json({ data: [] });
          },
        });
        await authority.list();
        assert.deepEqual(authority.snapshot(), { state: 'expired' });
        assert.equal(calls, 0);
        authority.dispose();
      }
    });
    test(`${label}/${kind}: failed timer cancellation cannot prevent logout abort and clearing`, async () => {
      let signal: AbortSignal | null | undefined;
      let finish!: (value: Response) => void;
      const states: string[] = [];
      const authority = create({
        now: () => 1,
        schedule: () => () => {
          throw Error('private cleanup');
        },
        onChange: (value) => states.push(value.state),
      });
      authority.authorize({
        expiresAt: 100,
        request: (_path, init) => {
          signal = init.signal;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        },
      });
      const pending = authority.list();
      authority.clear('unauthenticated');
      assert.equal(signal?.aborted, true);
      assert.deepEqual(authority.snapshot(), { state: 'unauthenticated' });
      assert.equal(states.at(-1), 'unauthenticated');
      finish(Response.json({ data: [] }));
      await pending;
      assert.deepEqual(authority.snapshot(), { state: 'unauthenticated' });
      authority.dispose();
    });
  }
}
