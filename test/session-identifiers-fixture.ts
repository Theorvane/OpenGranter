import assert from 'node:assert/strict';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';
export const sessionFixture = clientUserFixture;
export const suppliedSession = 'private supplied session 思考\n\ndata: forged';
export function sessionRequest(
  f: ReturnType<typeof sessionFixture>,
  base: string,
  fields: Record<string, unknown>,
  header?: string,
) {
  const request = f.request(base, fields);
  if (header !== undefined) request.headers.set('x-session-id', header);
  return request;
}
export function sessionPrivacy(f: ReturnType<typeof sessionFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(
    JSON.stringify([f.records, f.audits]),
    /session_id|x-session-id|supplied session/u,
  );
}
