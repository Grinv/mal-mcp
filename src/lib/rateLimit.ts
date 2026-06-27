// Serializes calls so consecutive acquisitions are spaced by at least
// `minIntervalMs`. Used to stay polite to the public Jikan instance
// (~3 req/s). Concurrency is effectively 1 from the limiter's point of view;
// in-flight network time still overlaps because acquire() resolves before the
// request runs.

export class RateLimiter {
  readonly #minIntervalMs: number;
  #tail: Promise<void> = Promise.resolve();
  #lastStart = 0;

  constructor(minIntervalMs: number) {
    this.#minIntervalMs = Math.max(0, minIntervalMs);
  }

  /** Resolves when the caller is allowed to proceed. */
  acquire(): Promise<void> {
    const prev = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    return prev.then(async () => {
      const wait = this.#lastStart + this.#minIntervalMs - Date.now();
      if (wait > 0) await delay(wait);
      this.#lastStart = Date.now();
      // Release the next waiter's gate; the interval above keeps them spaced.
      release();
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
