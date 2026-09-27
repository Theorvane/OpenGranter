import { planIssue, planIssueAuthor, planPullRequest } from './labels.ts';

export interface TriageApi {
  get(path: string): Promise<unknown>;
  post(path: string, body: object): Promise<void>;
  delete(path: string): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a GitHub event object');
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string') throw new Error(`Missing GitHub field: ${field}`);
  return result;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const result = value[field];
  if (!Number.isSafeInteger(result) || typeof result !== 'number' || result < 1) {
    throw new Error(`Invalid GitHub field: ${field}`);
  }
  return result;
}

function names(value: unknown, field: 'name' | 'login'): string[] {
  if (!Array.isArray(value)) throw new Error(`Expected GitHub ${field} list`);
  return value.map((entry) => stringField(asRecord(entry), field));
}

async function applyLabels(
  api: TriageApi,
  issuePath: string,
  changes: { readonly addLabels: readonly string[]; readonly removeLabels: readonly string[] },
): Promise<void> {
  for (const label of changes.removeLabels) {
    await api.delete(`${issuePath}/labels/${encodeURIComponent(label)}`);
  }
  if (changes.addLabels.length > 0) {
    await api.post(`${issuePath}/labels`, { labels: changes.addLabels });
  }
}

export async function handleTriageEvent(
  eventName: string,
  payload: unknown,
  repository: string,
  api: TriageApi,
): Promise<void> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Invalid repository name');
  }
  const event = asRecord(payload);
  const action = stringField(event, 'action');

  if (eventName === 'issues') {
    const number = numberField(asRecord(event.issue), 'number');
    const issuePath = `repos/${repository}/issues/${number}`;
    const issue = asRecord(await api.get(issuePath));
    const changes = planIssue({
      action,
      title: stringField(issue, 'title'),
      labels: names(issue.labels, 'name'),
    });
    await applyLabels(api, issuePath, changes);
    const author = planIssueAuthor(
      stringField(asRecord(issue.user), 'login'),
      names(issue.assignees, 'login'),
    );
    if (author !== null) {
      await api.post(`${issuePath}/assignees`, { assignees: [author] });
    }
    return;
  }

  if (eventName === 'pull_request_target') {
    const number = numberField(asRecord(event.pull_request), 'number');
    const pullPath = `repos/${repository}/pulls/${number}`;
    const issuePath = `repos/${repository}/issues/${number}`;
    const pull = asRecord(await api.get(pullPath));
    if (typeof pull.draft !== 'boolean') throw new Error('Missing GitHub field: draft');
    const plan = planPullRequest({
      headRef: stringField(asRecord(pull.head), 'ref'),
      draft: pull.draft,
      author: stringField(asRecord(pull.user), 'login'),
      labels: names(pull.labels, 'name'),
      requestedReviewers: names(pull.requested_reviewers, 'login'),
      assignees: names(pull.assignees, 'login'),
    });
    if (plan.requestReviewer !== null) {
      await api.post(`${pullPath}/requested_reviewers`, { reviewers: [plan.requestReviewer] });
    }
    if (plan.assignAuthor !== null) {
      await api.post(`${issuePath}/assignees`, { assignees: [plan.assignAuthor] });
    }
    await applyLabels(api, issuePath, plan);
    return;
  }

  throw new Error(`Unsupported GitHub event: ${eventName}`);
}
