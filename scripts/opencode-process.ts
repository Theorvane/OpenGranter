import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const OPENCODE_VERSION = '1.18.5';
export function openCodeConfig(baseURL: string) {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: 'opengranter/chat',
    small_model: 'opengranter/chat',
    enabled_providers: ['opengranter'],
    provider: {
      opengranter: {
        npm: '@ai-sdk/openai-compatible',
        name: 'OpenGranter',
        options: { baseURL, apiKey: '{env:OPENGRANTER_PROXY_TOKEN}' },
        models: { chat: { name: 'Conformance fixture', limit: { context: 32000, output: 1000 } } },
      },
    },
    permission: { '*': 'deny' },
  };
}
export function openCodeEnvironment(root: string, token: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_STATE_HOME: join(root, 'state'),
    OPENCODE_CONFIG: join(root, 'opencode.json'),
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENGRANTER_PROXY_TOKEN: token,
  };
}
export async function runBoundedProcess(
  executable: string,
  args: readonly string[],
  root: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      size = 0,
      failed = false;
    const fail = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const decoder = new StringDecoder('utf8');
    const timer = setTimeout(fail, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1048576) fail();
      else output += decoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1048576) fail();
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('External client process failed'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error('External client process failed'));
      else resolve(output + decoder.end());
    });
  });
}
