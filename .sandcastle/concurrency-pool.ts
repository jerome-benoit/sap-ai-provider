/** Internal node for the O(1) FIFO waiting queue. Not exported. */
interface QueueNode {
  resolve: () => void;
  next: QueueNode | null;
}

/**
 * A concurrency limiter that restricts parallel execution to a maximum number of tasks.
 * Queue operations are O(1) amortized (singly-linked list).
 */
export class ConcurrencyPool {
  private head: QueueNode | null = null;
  private tail: QueueNode | null = null;
  private running = 0;

  /**
   * @param max - Maximum number of concurrent tasks. Must be >= 1.
   */
  constructor(private readonly max: number) {
    if (max < 1) {
      throw new RangeError("ConcurrencyPool max must be >= 1");
    }
  }

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
      const node: QueueNode = { resolve, next: null };
      if (this.tail === null) {
        this.head = node;
        this.tail = node;
      } else {
        this.tail.next = node;
        this.tail = node;
      }
    });
  }

  private release(): void {
    this.running--;
    const next = this.head;
    if (next !== null) {
      this.head = next.next;
      if (this.head === null) {
        this.tail = null;
      }
      this.running++;
      next.resolve();
    }
  }
}
