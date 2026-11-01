import { runCodexAuth } from '../src/identity/codex-auth.ts';

const [action, ...extra] = process.argv.slice(2);
if ((action !== 'login' && action !== 'status' && action !== 'logout') || extra.length !== 0) {
  process.stderr.write('Usage: npm run codex:auth -- login|status|logout\n');
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    await runCodexAuth({
      action,
      binary: process.env.OPENGRANTER_CODEX_BIN ?? '',
      home: process.env.OPENGRANTER_CODEX_HOME ?? '',
      env: process.env,
      signal: controller.signal,
    });
    process.stdout.write(
      action === 'status'
        ? 'Codex login status succeeded; subscription inference is not verified.\n'
        : `Codex ${action} completed; no inference was performed.\n`,
    );
  } catch {
    process.stderr.write(
      'Codex authentication command failed. Check the trusted CLI, private directory, lock, and account authorization.\n',
    );
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
