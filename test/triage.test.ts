import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleTriageEvent, type TriageApi } from '../src/triage/handle-event.ts';
import { planIssue, planPullRequest } from '../src/triage/labels.ts';

test('issue titles map to stable type and area labels', () => {
  assert.deepEqual(
    planIssue({ action: 'opened', title: 'fix: deny unknown provider', labels: [] }),
    { addLabels: ['type:bug', 'status:needs-triage'], removeLabels: [] },
  );
  assert.deepEqual(planIssue({ action: 'opened', title: 'ci: run gateway tests', labels: [] }), {
    addLabels: ['type:chore', 'area:ci', 'status:needs-triage'],
    removeLabels: [],
  });
  assert.deepEqual(planIssue({ action: 'opened', title: 'Explore router fallback', labels: [] }), {
    addLabels: ['status:needs-triage'],
    removeLabels: [],
  });
});

test('issue relabeling preserves unrelated labels and does not reset triage', () => {
  assert.deepEqual(
    planIssue({
      action: 'edited',
      title: 'docs: explain route policies',
      labels: ['type:feature', 'area:ci', 'status:ready', 'priority:high'],
    }),
    { addLabels: ['type:docs'], removeLabels: ['type:feature', 'area:ci'] },
  );
  assert.deepEqual(
    planIssue({
      action: 'reopened',
      title: 'docs: explain route policies',
      labels: ['type:docs', 'status:ready'],
    }),
    { addLabels: [], removeLabels: [] },
  );
});

test('ready pull requests receive branch labels, reviewer, and author assignment', () => {
  assert.deepEqual(
    planPullRequest({
      headRef: 'security/42-restrict-secret-reads',
      draft: false,
      author: 'sjungwon03',
      labels: ['type:docs', 'priority:high'],
      requestedReviewers: [],
      assignees: [],
    }),
    {
      addLabels: ['type:security', 'area:security', 'ai-review-requested'],
      removeLabels: ['type:docs'],
      requestReviewer: 'sjungwon03-ai',
      assignAuthor: 'sjungwon03',
    },
  );
});

test('draft and already configured pull requests receive one review request', () => {
  assert.deepEqual(
    planPullRequest({
      headRef: 'docs/1-publish-planning-harness',
      draft: true,
      author: 'sjungwon03',
      labels: ['type:docs'],
      requestedReviewers: [],
      assignees: ['sjungwon03'],
    }),
    {
      addLabels: ['ai-review-requested'],
      removeLabels: [],
      requestReviewer: 'sjungwon03-ai',
      assignAuthor: null,
    },
  );
  assert.deepEqual(
    planPullRequest({
      headRef: 'docs/1-publish-planning-harness',
      draft: false,
      author: 'sjungwon03',
      labels: ['type:docs', 'ai-review-requested'],
      requestedReviewers: ['sjungwon03-ai'],
      assignees: ['sjungwon03'],
    }),
    {
      addLabels: [],
      removeLabels: [],
      requestReviewer: null,
      assignAuthor: null,
    },
  );
});

test('reviewer cannot be requested for their own pull request', () => {
  assert.deepEqual(
    planPullRequest({
      headRef: 'feat/7-add-route',
      draft: false,
      author: 'sjungwon03-ai',
      labels: [],
      requestedReviewers: [],
      assignees: [],
    }),
    {
      addLabels: ['type:feature'],
      removeLabels: [],
      requestReviewer: null,
      assignAuthor: 'sjungwon03-ai',
    },
  );
});

test('issue event applies labels from current GitHub metadata', async () => {
  const calls: string[] = [];
  const api: TriageApi = {
    get: async (path) => {
      calls.push(`GET ${path}`);
      return { title: 'ci: run checks', labels: [{ name: 'priority:high' }] };
    },
    post: async (path, body) => {
      calls.push(`POST ${path} ${JSON.stringify(body)}`);
    },
    delete: async (path) => {
      calls.push(`DELETE ${path}`);
    },
  };
  await handleTriageEvent('issues', { action: 'opened', issue: { number: 3 } }, 'o/r', api);
  assert.deepEqual(calls, [
    'GET repos/o/r/issues/3',
    'POST repos/o/r/issues/3/labels {"labels":["type:chore","area:ci","status:needs-triage"]}',
  ]);
});

test('ready pull request requests review, assigns author, and updates labels', async () => {
  const calls: string[] = [];
  const api: TriageApi = {
    get: async (path) => {
      calls.push(`GET ${path}`);
      return {
        head: { ref: 'docs/4-describe-policy' },
        draft: false,
        user: { login: 'sjungwon03' },
        labels: [{ name: 'type:bug' }],
        requested_reviewers: [],
        assignees: [],
      };
    },
    post: async (path, body) => {
      calls.push(`POST ${path} ${JSON.stringify(body)}`);
    },
    delete: async (path) => {
      calls.push(`DELETE ${path}`);
    },
  };
  await handleTriageEvent(
    'pull_request_target',
    { action: 'ready_for_review', pull_request: { number: 7 } },
    'o/r',
    api,
  );
  assert.deepEqual(calls, [
    'GET repos/o/r/pulls/7',
    'POST repos/o/r/pulls/7/requested_reviewers {"reviewers":["sjungwon03-ai"]}',
    'POST repos/o/r/issues/7/assignees {"assignees":["sjungwon03"]}',
    'DELETE repos/o/r/issues/7/labels/type%3Abug',
    'POST repos/o/r/issues/7/labels {"labels":["type:docs","ai-review-requested"]}',
  ]);
});

test('failed reviewer request does not claim review was requested', async () => {
  const calls: string[] = [];
  const api: TriageApi = {
    get: async () => ({
      head: { ref: 'feat/9-new-route' },
      draft: false,
      user: { login: 'sjungwon03' },
      labels: [],
      requested_reviewers: [],
      assignees: [],
    }),
    post: async (path) => {
      calls.push(path);
      if (path.endsWith('/requested_reviewers')) throw new Error('reviewer unavailable');
    },
    delete: async () => {},
  };
  await assert.rejects(
    handleTriageEvent(
      'pull_request_target',
      { action: 'opened', pull_request: { number: 9 } },
      'o/r',
      api,
    ),
    /reviewer unavailable/,
  );
  assert.deepEqual(calls, ['repos/o/r/pulls/9/requested_reviewers']);
});
