import { runCanonicalOperationsService } from '../src/gateway/canonical-operations-service.ts';

await runCanonicalOperationsService({
  env: process.env,
  signals: process,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
  exit: (code) => {
    process.exit(code);
  },
});
