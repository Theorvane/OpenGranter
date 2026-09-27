export type Effect = 'Allow' | 'Deny';

export interface Statement {
  readonly effect: Effect;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

export interface EvaluationInput {
  readonly principalActive: boolean;
  readonly action: string;
  readonly resource: string;
  readonly statements: readonly Statement[];
}

export type DecisionReason = 'inactive' | 'explicit-deny' | 'allowed' | 'implicit-deny';

export interface Decision {
  readonly effect: Effect;
  readonly reason: DecisionReason;
}

function matches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(value);
}

function applies(statement: Statement, action: string, resource: string): boolean {
  return (
    statement.actions.some((pattern) => matches(pattern, action)) &&
    statement.resources.some((pattern) => matches(pattern, resource))
  );
}

/** Evaluate the agreed first-release policy subset. Authentication happens before this call. */
export function evaluate(input: EvaluationInput): Decision {
  if (!input.principalActive) {
    return { effect: 'Deny', reason: 'inactive' };
  }

  let allowed = false;
  for (const statement of input.statements) {
    if (!applies(statement, input.action, input.resource)) continue;
    if (statement.effect === 'Deny') {
      return { effect: 'Deny', reason: 'explicit-deny' };
    }
    allowed = true;
  }

  return allowed
    ? { effect: 'Allow', reason: 'allowed' }
    : { effect: 'Deny', reason: 'implicit-deny' };
}
