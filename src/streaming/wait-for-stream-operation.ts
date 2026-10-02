/** Observe cancellation without retaining its reason or detaching rejected work. */
export function waitForStreamOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  discard?: (value: T) => void,
): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(new Error('Stream operation aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        if (settled) {
          try {
            discard?.(value);
          } catch {
            // Late resource cleanup cannot resurrect a cancelled operation.
          }
          return;
        }
        settled = true;
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
