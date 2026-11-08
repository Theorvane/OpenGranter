import { runSsoWorkspaceService } from '../src/gateway/sso-workspace-service.ts';

await runSsoWorkspaceService({
  env: process.env,
  signals: process,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
  exit: (code) => {
    process.exit(code);
  },
});
