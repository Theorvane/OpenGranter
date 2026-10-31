import { runGatewayService } from '../src/gateway/gateway-service.ts';

await runGatewayService({
  env: process.env,
  signals: process,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
  exit: (code) => {
    process.exit(code);
  },
});
