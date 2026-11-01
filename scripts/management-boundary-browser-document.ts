import { stripTypeScriptTypes } from 'node:module';

/** Component harness only; rejects ambiguous templates before producing HTML. */
export function createManagementBoundaryBrowserDocument(source: string, fixture: string): string {
  const marker = '__BOUNDARY_MODULE_URL__';
  if (fixture.split(marker).length !== 2) {
    throw new Error('Browser fixture requires exactly one module marker');
  }
  const moduleUrl =
    'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
  return fixture.replace(marker, moduleUrl);
}
