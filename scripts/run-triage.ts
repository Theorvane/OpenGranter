import { readFileSync } from 'node:fs';
import { handleTriageEvent, type TriageApi } from '../src/triage/handle-event.ts';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const token = requiredEnvironment('GITHUB_TOKEN');
const eventName = requiredEnvironment('GITHUB_EVENT_NAME');
const eventPath = requiredEnvironment('GITHUB_EVENT_PATH');
const repository = requiredEnvironment('GITHUB_REPOSITORY');

async function request(method: string, path: string, body?: object): Promise<unknown> {
  const response = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${path} failed: ${response.status}`);
  if (response.status === 204) return undefined;
  return response.json();
}

const api: TriageApi = {
  get: (path) => request('GET', path),
  post: async (path, body) => {
    await request('POST', path, body);
  },
  delete: async (path) => {
    await request('DELETE', path);
  },
};

const payload: unknown = JSON.parse(readFileSync(eventPath, 'utf8'));
await handleTriageEvent(eventName, payload, repository, api);
