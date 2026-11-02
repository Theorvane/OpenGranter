/** Local component smoke only; stdout is a standalone browser test document. */
import { readFileSync } from 'node:fs';
import { createManagementBoundaryBrowserDocument } from './management-boundary-browser-document.ts';

const source = readFileSync(new URL('../src/management/boundary-view.ts', import.meta.url), 'utf8');
const fixture = readFileSync(
  new URL('../test/browser/management-boundary.html', import.meta.url),
  'utf8',
);
process.stdout.write(createManagementBoundaryBrowserDocument(source, fixture));
