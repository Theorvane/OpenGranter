type Interrupted = { readonly state: 'uncertain' | 'cancelled' };

/** Client wait bound only: interruption does not undo a server mutation. */
export async function withTokenMutationLifetime<T>(
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T | Interrupted> {
  if (callerSignal?.aborted) return { state: 'cancelled' };
  const controller = new AbortController();
  let settled = false;
  let interrupt!: (result: Interrupted) => void;
  const interrupted = new Promise<Interrupted>((resolve) => {
    interrupt = (result) => {
      if (settled) return;
      settled = true;
      // Resolve first: abort-triggered reader failures must not replace this outcome.
      resolve(result);
      controller.abort();
    };
  });
  const cancel = () => interrupt({ state: 'cancelled' });
  callerSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => interrupt({ state: 'uncertain' }), 10_000);
  try {
    return await Promise.race([interrupted, operation(controller.signal)]);
  } catch {
    return { state: callerSignal?.aborted ? 'cancelled' : 'uncertain' };
  } finally {
    settled = true;
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
  }
}
