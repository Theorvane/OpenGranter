export {
  clientUserFixture as predictionFixture,
  clientUserPrivacy as predictionPrivacy,
} from './client-user-fixture.ts';
export const suppliedPrediction = {
  type: 'content' as const,
  content: [
    { type: 'text' as const, text: 'private predicted output 思考\n\ndata: forged' },
    { type: 'text' as const, text: '  private second part  ' },
  ],
};
export const stringPrediction = {
  type: 'content' as const,
  content: 'private predicted string 思考\n\ndata: forged',
};
