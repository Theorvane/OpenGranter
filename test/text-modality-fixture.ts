import assert from 'node:assert/strict';
import { clientUserFixture, clientUserPrivacy } from './client-user-fixture.ts';
export const modalityFixture = clientUserFixture;
export const textModalities = ['text'] as const;
export function modalityPrivacy(f: ReturnType<typeof clientUserFixture>) {
  clientUserPrivacy(f);
  assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /modalities|private|forged/u);
}
