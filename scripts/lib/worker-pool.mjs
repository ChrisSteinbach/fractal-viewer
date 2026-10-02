/**
 * The ONE `node:worker_threads` pool for CPU render work, extracted from
 * `scripts/transmission-readable.mjs`'s local class so a second consumer
 * (`scripts/de-preview-parallel.ts`) does not grow another copy of it —
 * the de-preview lesson: shared machinery that five sheets once grew five
 * wrong copies of.
 *
 * Two lifecycle behaviors beyond the extracted class:
 *
 * - **Idle workers do not hold the event loop.** A pool that outlives one
 *   render (the persistent-pool shape de-preview-parallel wants, so bundle
 *   and spawn amortize across a sheet's panels) must not keep the host
 *   process alive while idle. Workers start unref'd; `dispatch` refs them
 *   for the duration of queued/pending work and the pool unrefs again the
 *   moment it drains. A consumer that terminates the pool explicitly
 *   (`close()`) is unaffected — refs are irrelevant to `terminate()`.
 * - A worker that exits nonzero while idle is still a failure: the `exit`
 *   handler runs regardless of ref state.
 */

import { Worker } from "node:worker_threads";

export class WorkerPool {
  constructor(file, count) {
    if (!Number.isInteger(count) || count < 1)
      throw new Error(
        `WorkerPool needs a positive integer count, got ${count}`,
      );
    this.workers = [];
    this.idle = [];
    this.pending = new Map();
    this.queued = [];
    this.failed = new Set();
    this.closing = false;
    for (let index = 0; index < count; index++) {
      const worker = new Worker(file, { type: "module" });
      worker.on("message", (message) => this.done(worker, message));
      worker.on("error", (error) => this.fail(worker, error));
      worker.on("exit", (code) => {
        if (!this.closing)
          this.fail(worker, new Error(`Worker exited with code ${code}`));
      });
      // Idle workers must not hold the host event loop open (see header).
      worker.unref();
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  /** Ref every worker: work is queued or pending, the host must wait. */
  busy() {
    for (const worker of this.workers) worker.ref();
  }

  /** Unref every worker: the pool drained, the host may exit. Named
   * `goIdle` because the `idle` array property shares the obvious name. */
  goIdle() {
    for (const worker of this.workers) worker.unref();
  }

  dispatch(task) {
    return new Promise((resolve, reject) => {
      this.queued.push({ task, resolve, reject });
      this.busy();
      this.pump();
    });
  }

  pump() {
    if (this.failed.size) return;
    while (this.idle.length && this.queued.length) {
      const worker = this.idle.pop();
      const item = this.queued.shift();
      this.pending.set(item.task.id, { ...item, worker });
      worker.postMessage(item.task);
    }
  }

  done(worker, message) {
    const item = this.pending.get(message.id);
    if (!item) return;
    this.pending.delete(message.id);
    this.idle.push(worker);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message);
    this.pump();
    if (!this.pending.size && !this.queued.length) this.goIdle();
  }

  fail(worker, error) {
    if (this.failed.has(worker)) return;
    this.failed.add(worker);
    this.idle = this.idle.filter((candidate) => candidate !== worker);
    for (const [id, item] of this.pending) {
      if (item.worker === worker) {
        this.pending.delete(id);
        item.reject(error);
      }
    }
    for (const item of this.queued.splice(0)) item.reject(error);
    if (!this.pending.size && !this.queued.length) this.goIdle();
  }

  async close() {
    this.closing = true;
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}
