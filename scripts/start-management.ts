import { runManagementService } from '../src/gateway/management-service.ts';

await runManagementService({
  env: process.env,
  signals: process,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
  exit: (code) => {
    process.exit(code);
  },
});
