const managedLabels = [
  'type:feature',
  'type:bug',
  'type:docs',
  'type:chore',
  'type:security',
  'area:ci',
  'area:security',
] as const;
const managedLabelSet: ReadonlySet<string> = new Set(managedLabels);

const reviewer = 'sjungwon03-ai';

interface LabelChange {
  readonly addLabels: readonly string[];
  readonly removeLabels: readonly string[];
}

interface IssueInput {
  readonly action: string;
  readonly title: string;
  readonly labels: readonly string[];
}

interface PullRequestInput {
  readonly headRef: string;
  readonly draft: boolean;
  readonly author: string;
  readonly labels: readonly string[];
  readonly requestedReviewers: readonly string[];
  readonly assignees: readonly string[];
}

interface PullRequestPlan extends LabelChange {
  readonly requestReviewer: string | null;
  readonly assignAuthor: string | null;
}

function labelsForPrefix(prefix: string | undefined): readonly string[] {
  switch (prefix?.toLowerCase()) {
    case 'feat':
      return ['type:feature'];
    case 'fix':
      return ['type:bug'];
    case 'docs':
      return ['type:docs'];
    case 'security':
      return ['type:security', 'area:security'];
    case 'ci':
      return ['type:chore', 'area:ci'];
    case 'chore':
    case 'refactor':
    case 'test':
      return ['type:chore'];
    default:
      return [];
  }
}

function reconcileLabels(current: readonly string[], desired: readonly string[]): LabelChange {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  return {
    addLabels: desired.filter((label) => !currentSet.has(label)),
    removeLabels: current.filter((label) => managedLabelSet.has(label) && !desiredSet.has(label)),
  };
}

export function planIssue(input: IssueInput): LabelChange {
  const prefix = /^([a-z]+):\s+\S/i.exec(input.title)?.[1];
  const desired = [...labelsForPrefix(prefix)];
  const delta = reconcileLabels(input.labels, desired);
  if (input.action === 'opened' && !input.labels.some((label) => label.startsWith('status:'))) {
    return { ...delta, addLabels: [...delta.addLabels, 'status:needs-triage'] };
  }
  return delta;
}

/** Add the issue creator without removing any existing assignee. */
export function planIssueAuthor(author: string, assignees: readonly string[]): string | null {
  if (!author || assignees.some((login) => login.toLowerCase() === author.toLowerCase())) {
    return null;
  }
  return author;
}

export function planPullRequest(input: PullRequestInput): PullRequestPlan {
  const prefix = /^([a-z]+)\/\d+-[a-z0-9-]+$/.exec(input.headRef)?.[1];
  const desired = [...labelsForPrefix(prefix)];
  const delta = reconcileLabels(input.labels, desired);
  const canRequestReview = input.author.toLowerCase() !== reviewer;
  const reviewLabel = 'ai-review-requested';
  if (canRequestReview && !input.labels.includes(reviewLabel)) {
    desired.push(reviewLabel);
  }
  return {
    addLabels: [...delta.addLabels, ...desired.filter((label) => label === reviewLabel)],
    removeLabels: delta.removeLabels,
    requestReviewer:
      canRequestReview &&
      !input.requestedReviewers.some((login) => login.toLowerCase() === reviewer)
        ? reviewer
        : null,
    assignAuthor: input.assignees.some(
      (login) => login.toLowerCase() === input.author.toLowerCase(),
    )
      ? null
      : input.author,
  };
}
