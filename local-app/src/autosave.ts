export interface Autosave<T> {
  schedule: (value: T) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

/** Serializes writes; failed snapshots remain available for an explicit retry. */
export function createAutosave<T>(
  write: (value: T) => Promise<void>,
  onSaved: () => void,
  onError: (error: unknown) => void,
  delay = 500,
): Autosave<T> {
  let latest: { value: T } | null = null;
  let saved: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    if (inFlight) {
      return inFlight;
    }
    if (!latest || saved === latest) {
      return Promise.resolve();
    }
    inFlight = (async () => {
      try {
        while (latest && saved !== latest) {
          const snapshot = latest;
          await write(snapshot.value);
          saved = snapshot;
        }
        onSaved();
      } catch (error) {
        onError(error);
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return {
    schedule(value: T) {
      latest = { value };
      clearTimeout(timer);
      timer = setTimeout(() => void flush().catch(() => {}), delay);
    },
    flush,
    cancel() {
      clearTimeout(timer);
    },
  };
}
