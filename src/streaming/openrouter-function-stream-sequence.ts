import type { AssistantFunctionCall } from '../providers/assistant-response.ts';
import { snapshotChatUsage } from '../providers/chat-usage.ts';
import type {
  FunctionCallFragment,
  OpenRouterFunctionStreamPayload,
} from './openrouter-stream-chunks.ts';
import { OpenRouterStreamSequenceFailure } from './openrouter-stream-sequence.ts';

type Delta = Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>;
type Usage = Extract<OpenRouterFunctionStreamPayload, { kind: 'usage' }>['usage'];
type FinishReason = NonNullable<Delta['finishReason']>;
type CallState = {
  id?: string;
  type?: 'function';
  name?: string;
  arguments: string;
  hasArguments: boolean;
};
const MAX_RETAINED_UNITS = 1_048_576;

export type OpenRouterFunctionStreamOutcome =
  | Readonly<{ status: 'failed'; possiblyBilled: true }>
  | Readonly<{
      status: 'complete';
      id: string;
      model: string;
      finishReason: FinishReason;
      usage: Usage;
      toolCalls?: readonly AssistantFunctionCall[];
      systemFingerprint?: string | null;
      serviceTier?: string | null;
      nativeFinishReason?: string | null;
    }>;

/** Internal decoded-event sequence; completed calls are response content, never audit metadata. */
export class OpenRouterFunctionStreamSequence {
  #phase: 'open' | 'terminal' | 'usage' | 'done' | 'error' | 'invalid' | 'finalized' = 'open';
  #id: string | undefined;
  #model: string | undefined;
  #finishReason: FinishReason | undefined;
  #usage: Usage;
  #systemFingerprint: string | null | undefined;
  #serviceTier: string | null | undefined;
  #nativeFinishReason: string | null | undefined;
  #calls = new Map<number, CallState>();
  #retainedUnits = 0;
  #hasRefusal = false;

  private clearCalls(): void {
    this.#calls.clear();
    this.#retainedUnits = 0;
  }

  /** Discard private response assembly after an external transport/delivery failure. */
  discard(): void {
    this.clearCalls();
    this.#phase = 'invalid';
  }

  private fail(): never {
    this.clearCalls();
    this.#phase = 'invalid';
    throw new OpenRouterStreamSequenceFailure();
  }

  private retain(units: number): void {
    if (units > MAX_RETAINED_UNITS - this.#retainedUnits) this.fail();
    this.#retainedUnits += units;
  }

  private accumulate(fragment: FunctionCallFragment): void {
    let state = this.#calls.get(fragment.index);
    if (!state) {
      state = { arguments: '', hasArguments: false };
      this.#calls.set(fragment.index, state);
    }
    for (const [key, value] of [
      ['id', fragment.id],
      ['name', fragment.function?.name],
    ] as const) {
      if (value === undefined) continue;
      if (state[key] !== undefined && state[key] !== value) this.fail();
      if (state[key] === undefined) {
        this.retain(value.length);
        state[key] = value;
      }
    }
    if (fragment.type !== undefined) state.type = fragment.type;
    const args = fragment.function?.arguments;
    if (args !== undefined) {
      this.retain(args.length);
      state.arguments += args;
      state.hasArguments = true;
    }
  }

  private completeCalls(): readonly AssistantFunctionCall[] {
    const ids = new Set<string>();
    const result: AssistantFunctionCall[] = [];
    for (let index = 0; index < this.#calls.size; index++) {
      const state = this.#calls.get(index);
      if (
        !state?.id ||
        !state.name ||
        state.type !== 'function' ||
        !state.hasArguments ||
        ids.has(state.id)
      )
        this.fail();
      ids.add(state.id);
      result.push(
        Object.freeze({
          id: state.id,
          type: 'function',
          function: Object.freeze({ name: state.name, arguments: state.arguments }),
        }),
      );
    }
    return Object.freeze(result);
  }

  accept(event: OpenRouterFunctionStreamPayload): void {
    if (['done', 'error', 'invalid', 'finalized'].includes(this.#phase)) this.fail();
    if (event.kind === 'error') {
      this.clearCalls();
      this.#phase = 'error';
      return;
    }
    if (event.kind === 'done') {
      if (this.#phase !== 'usage') this.fail();
      this.#phase = 'done';
      return;
    }
    if (this.#phase === 'open' && event.kind === 'delta' && this.#id === undefined) {
      this.#id = event.id;
      this.#model = event.model;
    }
    if (event.id !== this.#id || event.model !== this.#model) this.fail();
    if (event.kind === 'delta') {
      if (this.#phase !== 'open') this.fail();
      if (typeof event.refusal === 'string' && event.refusal.length > 0) this.#hasRefusal = true;
      for (const fragment of event.toolCalls ?? []) this.accumulate(fragment);
      if (event.finishReason !== null) {
        const hasCalls = this.#calls.size > 0;
        if (hasCalls !== (event.finishReason === 'tool_calls') || (hasCalls && this.#hasRefusal))
          this.fail();
        if (hasCalls) this.completeCalls();
        this.#finishReason = event.finishReason;
        this.#phase = 'terminal';
      }
      return;
    }
    if (
      this.#phase !== 'terminal' ||
      (event.finishReason !== null && event.finishReason !== this.#finishReason)
    )
      this.fail();
    this.#usage = snapshotChatUsage(event.usage);
    this.#systemFingerprint = event.systemFingerprint;
    this.#serviceTier = event.serviceTier;
    this.#nativeFinishReason = event.nativeFinishReason;
    this.#phase = 'usage';
  }

  finish(): OpenRouterFunctionStreamOutcome {
    if (this.#phase === 'error') {
      this.#phase = 'finalized';
      return Object.freeze({ status: 'failed', possiblyBilled: true });
    }
    if (
      this.#phase !== 'done' ||
      this.#id === undefined ||
      this.#model === undefined ||
      this.#finishReason === undefined
    )
      this.fail();
    const calls = this.#calls.size > 0 ? this.completeCalls() : undefined;
    const result = Object.freeze({
      status: 'complete' as const,
      id: this.#id,
      model: this.#model,
      finishReason: this.#finishReason,
      usage: this.#usage,
      ...(calls === undefined ? {} : { toolCalls: calls }),
      ...(this.#systemFingerprint === undefined
        ? {}
        : { systemFingerprint: this.#systemFingerprint }),
      ...(this.#serviceTier === undefined ? {} : { serviceTier: this.#serviceTier }),
      ...(this.#nativeFinishReason === undefined
        ? {}
        : { nativeFinishReason: this.#nativeFinishReason }),
    });
    this.clearCalls();
    this.#phase = 'finalized';
    return result;
  }
}
