import type { ChatMessage } from '../gateway/chat-messages.ts';
import {
  type FunctionTool,
  snapshotBoundedJsonObject,
  type ToolChoice,
} from '../gateway/chat-tools.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import { type AssistantResponse, normalizeAssistantResponse } from './assistant-response.ts';

function invalid(): never {
  throw new DirectProviderFailure('other', false, false);
}
function name(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function input(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return snapshotBoundedJsonObject(value);
  } catch {
    invalid();
  }
}
function argumentsObject(value: string): Readonly<Record<string, unknown>> {
  try {
    return input(JSON.parse(value));
  } catch {
    invalid();
  }
}

/** Translate only captured portable custom functions; native tools are never executed here. */
export function prepareAnthropicFunctions(
  tools: readonly FunctionTool[] | undefined,
  choice: ToolChoice | undefined,
  parallel: boolean | undefined,
): object {
  const nativeTools = tools?.map(({ function: definition }) => {
    if (!name(definition.name)) invalid();
    const schema = definition.parameters ?? { type: 'object' };
    if (schema.type !== 'object') invalid();
    return {
      name: definition.name,
      input_schema: schema,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.strict == null ? {} : { strict: definition.strict }),
    };
  });
  let nativeChoice: Record<string, unknown> | undefined;
  if (typeof choice === 'object') {
    if (!name(choice.function.name)) invalid();
    nativeChoice = { type: 'tool', name: choice.function.name };
  } else if (choice !== undefined || parallel !== undefined) {
    nativeChoice = { type: choice === 'required' ? 'any' : (choice ?? 'auto') };
  }
  // ToolChoiceNone has no parallel field: forbidding all calls already satisfies either control.
  if (nativeChoice && nativeChoice.type !== 'none' && parallel !== undefined)
    nativeChoice.disable_parallel_tool_use = !parallel;
  return {
    ...(nativeTools === undefined ? {} : { tools: nativeTools }),
    ...(nativeChoice === undefined ? {} : { tool_choice: nativeChoice }),
  };
}

/** Complete adjacent tool results form one native user turn, following the matching assistant. */
export function prepareAnthropicMessages(messages: readonly ChatMessage[]): readonly object[] {
  const native: { role: string; content: string | null | object[] }[] = [];
  let results: object[] | undefined;
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!results) {
        results = [];
        native.push({ role: 'user', content: results });
      }
      results.push({
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: message.content,
      });
      continue;
    }
    results = undefined;
    if (message.role === 'assistant' && message.tool_calls?.length) {
      native.push({
        role: 'assistant',
        content: [
          ...(message.content === null || message.content === ''
            ? []
            : [{ type: 'text', text: message.content }]),
          ...message.tool_calls.map((call) => {
            if (!name(call.function.name)) invalid();
            return {
              type: 'tool_use',
              id: call.id,
              name: call.function.name,
              input: argumentsObject(call.function.arguments),
            };
          }),
        ],
      });
    } else native.push({ role: message.role, content: message.content });
  }
  return native;
}

/** Normalize bounded custom tool_use objects without exposing unsupported native blocks. */
export function normalizeAnthropicFunctionResponse(
  blocks: readonly unknown[],
  stopReason: unknown,
): AssistantResponse | undefined {
  if (stopReason !== 'tool_use' || blocks.length > 128) return undefined;
  const calls: object[] = [],
    text: string[] = [];
  for (const value of blocks) {
    const block = object(value);
    if (!block) return undefined;
    if (
      block.type === 'text' &&
      typeof block.text === 'string' &&
      Object.keys(block).every((key) => key === 'type' || key === 'text')
    )
      text.push(block.text);
    else if (
      block.type === 'tool_use' &&
      name(block.name) &&
      Object.keys(block).every((key) => ['type', 'id', 'name', 'input'].includes(key))
    ) {
      calls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(input(block.input)) },
      });
    } else return undefined;
  }
  return normalizeAssistantResponse(
    { role: 'assistant', content: text.length ? text.join('') : null, tool_calls: calls },
    'tool_calls',
  );
}
