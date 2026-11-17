import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const gateIds = [
  'installation',
  'discovery',
  'requests',
  'controls',
  'records',
  'restart',
  'handoff',
] as const;
type Result = 'invalid' | 'incomplete-claims' | 'complete-claims';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function reference(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= 200 &&
    value.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
  );
}
function timestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/** Validates redacted operator claims only; never opens or verifies evidence. */
export function validateHandoff(value: unknown): Result {
  if (
    !record(value) ||
    !keys(value, ['revision', 'imageDigest', 'baseDigest', 'configRef', 'gates'])
  )
    return 'invalid';
  if (typeof value.revision !== 'string' || !/^[a-f0-9]{40}$/.test(value.revision))
    return 'invalid';
  for (const key of ['imageDigest', 'baseDigest']) {
    if (typeof value[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value[key]))
      return 'invalid';
  }
  if (
    !reference(value.configRef) ||
    !Array.isArray(value.gates) ||
    value.gates.length !== gateIds.length
  )
    return 'invalid';
  const remaining = new Set<string>(gateIds);
  let complete = true;
  for (const gate of value.gates) {
    if (!record(gate) || !keys(gate, ['id', 'status', 'timestamp', 'owner', 'evidenceRef']))
      return 'invalid';
    if (typeof gate.id !== 'string' || !remaining.delete(gate.id)) return 'invalid';
    if (
      !['PASS', 'FAIL', 'BLOCKED'].includes(gate.status as string) ||
      !timestamp(gate.timestamp) ||
      !reference(gate.owner) ||
      !reference(gate.evidenceRef)
    )
      return 'invalid';
    if (gate.status !== 'PASS') complete = false;
  }
  return complete ? 'complete-claims' : 'incomplete-claims';
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (process.argv.length !== 3 || !file) {
    console.error('Usage: check-deployment-handoff.ts <redacted-manifest.json>');
    process.exitCode = 1;
    return;
  }
  try {
    const text = await readFile(file, 'utf8');
    const result = validateHandoff(JSON.parse(text));
    if (result === 'invalid') {
      console.error('Invalid handoff metadata. No supplied values are displayed.');
      process.exitCode = 1;
    } else {
      console.log(`${result}; operator claims only, not verified acceptance.`);
      process.exitCode = result === 'complete-claims' ? 0 : 2;
    }
  } catch {
    console.error('Cannot read or parse handoff metadata. No supplied values are displayed.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
