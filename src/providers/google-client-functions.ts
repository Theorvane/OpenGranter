import type { ChatMessage } from '../gateway/chat-messages.ts';
import {
  type FunctionTool,
  snapshotBoundedJsonObject,
  type ToolChoice,
} from '../gateway/chat-tools.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import {
  type AssistantFunctionCall,
  type AssistantResponse,
  normalizeAssistantResponse,
} from './assistant-response.ts';
import {
  MAX_GOOGLE_SIGNATURE_UNITS,
  snapshotGoogleThoughtSignature,
} from './google-thought-signature.ts';

const LOCAL_PREFIX = 'og_google_missing_id_';
const LOCAL_ID =
  /^og_google_missing_id_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
function invalid(): never {
  throw new DirectProviderFailure('other', false, false);
}
function name(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    return input(JSON.parse(value) as unknown);
  } catch {
    invalid();
  }
}
function nativeId(id: string): object {
  return LOCAL_ID.test(id) ? {} : { id };
}

/** Translate captured custom declarations without claiming strict or single-call equivalence. */
export function prepareGoogleFunctions(
  tools: readonly FunctionTool[] | undefined,
  choice: ToolChoice | undefined,
  parallel: boolean | undefined,
): object {
  if (parallel === false && choice !== 'none') invalid();
  const declarations = tools?.map(({ function: definition }) => {
    if (
      !name(definition.name) ||
      definition.strict === true ||
      (definition.parameters !== undefined && definition.parameters.type !== 'object')
    )
      invalid();
    return {
      name: definition.name,
      description: definition.description ?? '',
      ...(definition.parameters === undefined
        ? {}
        : { parametersJsonSchema: definition.parameters }),
    };
  });
  let config: object | undefined;
  if (typeof choice === 'object') {
    if (!name(choice.function.name)) invalid();
    config = { mode: 'ANY', allowedFunctionNames: [choice.function.name] };
  } else if (choice !== undefined)
    config = { mode: choice === 'required' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO' };
  return {
    ...(declarations === undefined
      ? {}
      : { tools: declarations.length ? [{ functionDeclarations: declarations }] : [] }),
    ...(config === undefined ? {} : { toolConfig: { functionCallingConfig: config } }),
  };
}

/** Preserve exact result strings, correlation and original call order without inventing native IDs. */
export function prepareGoogleMessages(messages: readonly ChatMessage[]): readonly object[] {
  const native: object[] = [];
  let calls: readonly { id: string; function: { name: string } }[] = [],
    results = new Map<string, string>();
  for (const message of messages) {
    if (typeof message.content !== 'string' && message.content !== null) invalid();
    if (message.role === 'tool') {
      if (
        !calls.some((call) => call.id === message.tool_call_id) ||
        results.has(message.tool_call_id)
      )
        invalid();
      results.set(message.tool_call_id, message.content);
      if (results.size === calls.length) {
        native.push({
          role: 'user',
          parts: calls.map((call) => ({
            functionResponse: {
              ...nativeId(call.id),
              name: call.function.name,
              response: { output: results.get(call.id) },
            },
          })),
        });
        calls = [];
        results = new Map();
      }
      continue;
    }
    if (calls.length) invalid();
    if (message.role === 'assistant' && message.tool_calls?.length) {
      calls = message.tool_calls;
      native.push({
        role: 'model',
        parts: [
          ...(message.content === null || message.content === ''
            ? []
            : [{ text: message.content }]),
          ...message.tool_calls.map((call) => {
            if (!name(call.function.name)) invalid();
            return {
              ...(call.extra_content === undefined
                ? {}
                : { thoughtSignature: call.extra_content.google.thought_signature }),
              functionCall: {
                ...nativeId(call.id),
                name: call.function.name,
                args: argumentsObject(call.function.arguments),
              },
            };
          }),
        ],
      });
    } else
      native.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      });
  }
  if (calls.length) invalid();
  return native;
}

/** Complete custom function objects; signed nonstream mapping requires an explicit opt-in. */
export function normalizeGoogleFunctionResponse(
  parts: readonly unknown[],
  allowSignatures = false,
): AssistantResponse | undefined {
  if (parts.length > 128) return undefined;
  let signatureUnits = 0;
  const calls: AssistantFunctionCall[] = [],
    text: string[] = [],
    ids = new Set<string>();
  for (const value of parts) {
    const part = record(value);
    if (
      !part ||
      (part.thought !== undefined && part.thought !== false) ||
      Object.keys(part).some(
        (key) =>
          ![
            'text',
            'functionCall',
            'thought',
            ...(allowSignatures ? ['thoughtSignature'] : []),
          ].includes(key),
      )
    )
      return undefined;
    if (typeof part.text === 'string' && !Object.hasOwn(part, 'functionCall')) {
      if (Object.hasOwn(part, 'thoughtSignature')) return undefined;
      text.push(part.text);
      continue;
    }
    if (Object.hasOwn(part, 'text')) return undefined;
    const call = record(part.functionCall);
    if (
      !call ||
      !name(call.name) ||
      Object.keys(call).some((key) => !['id', 'name', 'args'].includes(key)) ||
      (call.id !== undefined &&
        (typeof call.id !== 'string' || !call.id || call.id.startsWith(LOCAL_PREFIX)))
    )
      return undefined;
    const id = call.id === undefined ? LOCAL_PREFIX + crypto.randomUUID() : (call.id as string);
    if (ids.has(id)) return undefined;
    ids.add(id);
    const extra = Object.hasOwn(part, 'thoughtSignature')
      ? snapshotGoogleThoughtSignature({ google: { thought_signature: part.thoughtSignature } })
      : undefined;
    signatureUnits += extra?.google.thought_signature.length ?? 0;
    if (signatureUnits > MAX_GOOGLE_SIGNATURE_UNITS) return undefined;
    calls.push({
      id,
      type: 'function',
      ...(extra === undefined ? {} : { extra_content: extra }),
      function: {
        name: call.name,
        arguments: JSON.stringify(input(call.args === undefined ? {} : call.args)),
      },
    });
  }
  const normalized = normalizeAssistantResponse(
    {
      role: 'assistant',
      content: text.length ? text.join('') : null,
      tool_calls: calls.map(({ id, type, function: operation }) => ({
        id,
        type,
        function: operation,
      })),
    },
    'tool_calls',
  );
  return normalized
    ? {
        ...normalized,
        tool_calls: Object.freeze(
          calls.map((call) => Object.freeze({ ...call, function: Object.freeze(call.function) })),
        ),
      }
    : undefined;
}
