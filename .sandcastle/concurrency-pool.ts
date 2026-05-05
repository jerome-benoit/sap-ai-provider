/**
 * A concurrency limiter that restricts parallel execution to a maximum number of tasks.
 */
export class ConcurrencyPool {
  private readonly queue: (() => void)[] = [];
  private running = 0;

  /**
   * @param max - Maximum number of concurrent tasks.
   */
  constructor(private readonly max: number) {}

  /**
   * Executes the given async function, waiting if the pool is at capacity.
   * @param fn - Async function to execute within the pool.
   * @returns The result of the function.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}
