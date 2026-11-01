import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createManagementBoundaryBrowserDocument as build } from '../scripts/management-boundary-browser-document.ts';

const marker = '__BOUNDARY_MODULE_URL__';
const fixture = '<html><script type="module">await import("' + marker + '");</script></html>';

test('browser document embeds stripped source and preserves the fixture', () => {
  const source = 'export const value: number = 42;';
  const html = build(source, fixture);
  const url = html.match(/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/)?.[0];
  assert.ok(url);
  assert.equal(
    Buffer.from(url.split(',')[1] ?? '', 'base64').toString(),
    stripTypeScriptTypes(source),
  );
  assert.equal(html.replace(url, marker), fixture);
});

for (const [name, template] of [
  ['missing', '<html></html>'],
  ['duplicate', marker + marker],
]) {
  test('browser document rejects ' + name + ' module markers', () => {
    assert.throws(
      () => build('export const value = 1;', template ?? ''),
      /exactly one module marker/,
    );
  });
}

test('browser document refuses malformed TypeScript', () => {
  assert.throws(() => build('export const value: = ;', fixture));
});

test('browser document keeps closing-script source inert', () => {
  const source = 'export const text = "</script><script>throw 1</script>";';
  const html = build(source, fixture);
  assert.equal(html.split('</script>').length, 2);
  assert.equal(html.includes('throw 1'), false);
});
