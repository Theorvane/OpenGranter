import { runSsoBrowserService } from '../src/gateway/sso-browser-service.ts';

await runSsoBrowserService({
  env: process.env,
  signals: process,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
  exit: (code) => {
    process.exit(code);
  },
});
