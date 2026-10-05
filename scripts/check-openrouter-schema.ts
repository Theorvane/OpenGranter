import { readFile } from 'node:fs/promises';
import {
  compareOfficialModelQuerySchema,
  validateModelQuerySchemaPin,
} from './openrouter-model-query-schema.ts';
import {
  compareOfficialModelResponseSchema,
  validateModelResponseSchemaPin,
} from './openrouter-model-response-schema.ts';
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
  const modelPin: unknown = JSON.parse(
    await readFile(
      new URL('../contracts/openrouter-model-query-schema.json', import.meta.url),
      'utf8',
    ),
  );
  validateModelQuerySchemaPin(modelPin);
  const responsePin: unknown = JSON.parse(
    await readFile(
      new URL('../contracts/openrouter-model-response-schema.json', import.meta.url),
      'utf8',
    ),
  );
  validateModelResponseSchemaPin(responsePin);
  const source = args[0] === '--live' ? await fetchOfficialSchema() : undefined;
  const chatMatches = source === undefined || compareOfficialSchema(source, pin);
  const modelsMatch = source === undefined || compareOfficialModelQuerySchema(source, modelPin);
  const responseMatches =
    source === undefined || compareOfficialModelResponseSchema(source, responsePin);
  if (!chatMatches) {
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
  if (!modelsMatch) {
    process.stderr.write(
      'FAIL selected OpenRouter model-query schema drift; review the pin and contracts\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      args[0] === '--live'
        ? 'PASS selected OpenRouter model-query schema unchanged\n'
        : 'PASS pinned OpenRouter model-query schema integrity\n',
    );
  }
  if (!responseMatches) {
    process.stderr.write(
      'FAIL selected OpenRouter model-response schema drift; review the pin and contracts\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      args[0] === '--live'
        ? 'PASS selected OpenRouter model-response schema unchanged\n'
        : 'PASS pinned OpenRouter model-response schema integrity\n',
    );
  }
} catch {
  process.stderr.write('FAIL OpenRouter schema check unavailable or invalid; no pin changed\n');
  process.exitCode = 1;
}
