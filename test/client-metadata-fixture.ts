export {
  clientUserFixture as metadataFixture,
  clientUserPrivacy as metadataPrivacy,
} from './client-user-fixture.ts';
export const suppliedMetadata = {
  'private Session': 'private supplied metadata 思考\n\ndata: forged',
  principalId: 'private forged principal',
  credentialId: 'private forged credential',
  model: 'private unapproved model',
  user: 'private arbitrary user tag',
};
