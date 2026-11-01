/** Local component smoke only; stdout is a standalone browser test document. */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/management/boundary-view.ts', import.meta.url), 'utf8');
const fixture = readFileSync(
  new URL('../test/browser/management-boundary.html', import.meta.url),
  'utf8',
);
const moduleUrl =
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
process.stdout.write(fixture.replace('__BOUNDARY_MODULE_URL__', moduleUrl));
