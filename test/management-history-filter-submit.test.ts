import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';
import { mountSsoUsageWorkspace as source } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const js = await buildManagementBrowser({
  root: process.cwd(),
  entry: 'src/management/sso-usage-workspace.ts',
});
const artifact = (await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
)) as { mountSsoUsageWorkspace: typeof source };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const empty = () => Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
function form(root: TokenElement) {
  const node = root.all().find((node) => node.tag === 'form');
  assert.ok(node, 'history filters must be a semantic form');
  return node;
}
function input(node: TokenElement, label: string) {
  const wrapper = node.all().find((item) => item.tag === 'label' && item.textContent === label);
  assert.ok(wrapper, label);
  const field = wrapper.all().find((item) => item.tag === 'input');
  assert.ok(field);
  return field;
}
function submit(node: TokenElement) {
  let prevented = false;
  node.listeners.submit?.({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true, 'all submits prevent default navigation');
}
for (const [build, mount] of [
  ['source', source],
  ['artifact', artifact.mountSsoUsageWorkspace],
] as const) {
  for (const view of ['Usage history', 'Audit history']) {
    test(
      build + ': ' + view + ' submits existing filters once and preserves correction',
      async () => {
        const root = new TokenElement();
        const paths: string[] = [];
        const app = mount(root, new EventTarget(), { now: () => 1, schedule: () => () => {} });
        try {
          await app.authorize({
            request: async (path) => {
              paths.push(path);
              return empty();
            },
            expiresAt: 100,
          });
          root.button(view).click();
          await settle();
          const filters = form(root);
          assert.equal(filters.attrs['aria-label'], view + ' filters');
          assert.equal(filters.attrs.novalidate, '');
          assert.equal(root.button('Apply filters').attrs.type, 'submit');
          assert.equal(root.button('Clear filters').attrs.type, 'button');
          input(filters, 'Model').value = 'model/한글';
          input(filters, 'Page size (1–100)').value = '2';
          const count = paths.length;
          submit(filters);
          await settle();
          assert.equal(paths.length, count + 1);
          const lastPath = paths.at(-1);
          assert.ok(lastPath);
          const url = new URL(lastPath, 'http://example.invalid');
          assert.equal(
            url.pathname,
            view === 'Audit history' ? '/v1/audit' : '/management/v1/usage',
          );
          assert.equal(url.searchParams.get('model'), 'model/한글');
          assert.equal(url.searchParams.get('limit'), '2');
          assert.equal(url.searchParams.has('cursor'), false);
          submit(filters);
          assert.equal(paths.length, count + 1, 'detached form cannot request');
          input(form(root), 'From (UTC)').value = '2026-11-06T12:00';
          input(form(root), 'To (UTC, exclusive)').value = '2026-11-05T12:00';
          submit(form(root));
          await settle();
          assert.equal(paths.length, count + 1, 'invalid range does not fetch');
          assert.match(root.text(), /Invalid .* filters/);
          assert.equal(input(form(root), 'From (UTC)').value, '2026-11-06T12:00');
          input(form(root), 'To (UTC, exclusive)').value = '2026-11-07T12:00';
          let prevented = false;
          root.button('Apply filters').listeners.click?.({
            preventDefault() {
              prevented = true;
            },
          });
          await settle();
          assert.equal(prevented, true, 'click consumes default submit to avoid a duplicate');
          assert.equal(paths.length, count + 2);
        } finally {
          app.dispose();
        }
      },
    );
    test(
      build + ': ' + view + ' stale forms cannot consume renewed authority or suspended expiry',
      async () => {
        const root = new TokenElement();
        const lifecycle = new EventTarget();
        let time = 1;
        let calls = 0;
        const grant = {
          request: async () => {
            calls++;
            return empty();
          },
          expiresAt: 100,
        };
        const app = mount(root, lifecycle, { now: () => time, schedule: () => () => {} });
        const open = async () => {
          root.button(view).click();
          await settle();
          return form(root);
        };
        try {
          await app.authorize(grant);
          const old = await open();
          await app.authorize(grant);
          const renewed = calls;
          submit(old);
          assert.equal(calls, renewed);
          const hidden = await open();
          lifecycle.dispatchEvent(new Event('pagehide'));
          submit(hidden);
          assert.equal(calls, renewed + 1);
          lifecycle.dispatchEvent(new Event('pageshow'));
          await app.authorize(grant);
          const expired = await open();
          const beforeExpiry = calls;
          time = 100;
          submit(expired);
          assert.equal(calls, beforeExpiry);
          assert.match(root.text(), /expired/);
          time = 1;
          await app.authorize(grant);
          const disposed = await open();
          const beforeDispose = calls;
          app.dispose();
          submit(disposed);
          assert.equal(calls, beforeDispose);
        } finally {
          app.dispose();
        }
      },
    );
  }
}
