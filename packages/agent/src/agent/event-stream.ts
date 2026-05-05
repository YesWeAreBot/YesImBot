// Generic event stream class for async iteration
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private settled = false;
  private finalResult?: R;
  private finalError: unknown;
  private settlementPromise: Promise<void>;
  private resolveSettlement!: () => void;

  constructor(
    private isComplete: (event: T) => boolean,
    private extractResult: (event: T) => R,
  ) {
    this.settlementPromise = new Promise((resolve) => {
      this.resolveSettlement = resolve;
    });
  }

  push(event: T): void {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      this.finalResult = this.extractResult(event);
      this.settle();
    }

    // Deliver to waiting consumer or queue it
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  end(result?: R): void {
    this.done = true;
    if (result !== undefined) {
      this.finalResult = result;
    }
    this.settle();
    // Notify all waiting consumers that we're done
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  error(error: unknown): void {
    if (this.done) return;

    this.done = true;
    this.finalError = error;
    this.settle();
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) =>
          this.waiting.push(resolve),
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }

  async result(): Promise<R> {
    await this.settlementPromise;
    if (this.finalError !== undefined) {
      throw this.finalError;
    }
    return this.finalResult as R;
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveSettlement();
  }
}
