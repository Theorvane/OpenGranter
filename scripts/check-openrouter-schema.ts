import { readFile } from 'node:fs/promises';
import {
  compareOfficialSchema,
  fetchOfficialSchema,
  validateSchemaPin,
} from './openrouter-schema.ts';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--live')) throw new Error();
  const pin: unknown = JSON.parse(
    await readFile(new URL('../contracts/openrouter-request-schema.json', import.meta.url), 'utf8'),
  );
  validateSchemaPin(pin);
  if (args[0] === '--live' && !compareOfficialSchema(await fetchOfficialSchema(), pin)) {
    process.stderr.write(
      'FAIL selected OpenRouter request schema drift; review the pin and contracts\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      args[0] === '--live'
        ? 'PASS selected OpenRouter request schema unchanged\n'
        : 'PASS pinned OpenRouter request schema integrity\n',
    );
  }
} catch {
  process.stderr.write('FAIL OpenRouter schema check unavailable or invalid; no pin changed\n');
  process.exitCode = 1;
}
