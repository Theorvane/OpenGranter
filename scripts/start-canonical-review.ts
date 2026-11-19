import { runCanonicalReviewService } from '../src/gateway/canonical-review-service.ts';

await runCanonicalReviewService({
  env: process.env,
  signals: process,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
  exit: (code) => {
    process.exit(code);
  },
});
