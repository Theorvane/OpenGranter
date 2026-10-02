import type { OpenRouterTextStreamPayload } from './openrouter-stream-chunks.ts';

type Delta = Extract<OpenRouterTextStreamPayload, { kind: 'delta' }>;
type Usage = Extract<OpenRouterTextStreamPayload, { kind: 'usage' }>['usage'];
type FinishReason = NonNullable<Delta['finishReason']>;

export type OpenRouterTextStreamOutcome =
  | Readonly<{
      status: 'complete';
      id: string;
      model: string;
      finishReason: FinishReason;
      usage: Usage;
      systemFingerprint?: string | null;
      serviceTier?: string | null;
      nativeFinishReason?: string | null;
    }>
  | Readonly<{ status: 'failed'; possiblyBilled: true }>;

export class OpenRouterStreamSequenceFailure extends Error {
  readonly possiblyBilled = true;

  constructor() {
    super('Invalid OpenRouter stream sequence');
    this.name = 'OpenRouterStreamSequenceFailure';
  }
}

/** Validate decoded, text-only OpenRouter events without retaining response content. */
export class OpenRouterTextStreamSequence {
  private phase: 'open' | 'terminal' | 'usage' | 'done' | 'error' | 'invalid' | 'finalized' =
    'open';
  private id: string | undefined;
  private model: string | undefined;
  private finishReason: FinishReason | undefined;
  private usage: Usage;
  private nativeFinishReason: string | null | undefined;
  private systemFingerprint: string | null | undefined;
  private serviceTier: string | null | undefined;

  private fail(): never {
    this.phase = 'invalid';
    throw new OpenRouterStreamSequenceFailure();
  }

  accept(event: OpenRouterTextStreamPayload): void {
    if (
      this.phase === 'done' ||
      this.phase === 'error' ||
      this.phase === 'invalid' ||
      this.phase === 'finalized'
    )
      this.fail();
    if (event.kind === 'error') {
      this.phase = 'error';
      return;
    }
    if (event.kind === 'done') {
      if (this.phase !== 'usage') this.fail();
      this.phase = 'done';
      return;
    }
    if (this.phase === 'open' && event.kind === 'delta' && this.id === undefined) {
      this.id = event.id;
      this.model = event.model;
    }
    if (event.id !== this.id || event.model !== this.model) this.fail();
    if (event.kind === 'delta') {
      if (this.phase !== 'open') this.fail();
      if (event.finishReason !== null) {
        this.finishReason = event.finishReason;
        this.phase = 'terminal';
      }
      return;
    }
    if (
      this.phase !== 'terminal' ||
      (event.finishReason !== null && event.finishReason !== this.finishReason)
    )
      this.fail();
    this.usage = event.usage === undefined ? undefined : Object.freeze({ ...event.usage });
    this.systemFingerprint = event.systemFingerprint;
    this.serviceTier = event.serviceTier;
    this.nativeFinishReason = event.nativeFinishReason;
    this.phase = 'usage';
  }

  finish(): OpenRouterTextStreamOutcome {
    const phase = this.phase;
    if (phase === 'error') {
      this.phase = 'finalized';
      return Object.freeze({ status: 'failed', possiblyBilled: true });
    }
    if (
      phase !== 'done' ||
      this.id === undefined ||
      this.model === undefined ||
      this.finishReason === undefined
    )
      this.fail();
    this.phase = 'finalized';
    return Object.freeze({
      status: 'complete',
      id: this.id,
      model: this.model,
      finishReason: this.finishReason,
      usage: this.usage,
      ...(this.serviceTier === undefined ? {} : { serviceTier: this.serviceTier }),
      ...(this.nativeFinishReason === undefined
        ? {}
        : { nativeFinishReason: this.nativeFinishReason }),
      ...(this.systemFingerprint === undefined
        ? {}
        : { systemFingerprint: this.systemFingerprint }),
    });
  }
}
