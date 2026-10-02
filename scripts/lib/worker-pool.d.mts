/** Types for the shared `node:worker_threads` render pool. */

/**
 * A fixed-size pool of module workers that take tasks (structured-cloneable
 * objects carrying a unique numeric `id`) and reply with messages carrying
 * the same `id`; a reply with a truthy `error` string rejects the task's
 * promise. Idle workers are unref'd, so a persistent pool never holds the
 * host event loop open; `dispatch` refs for the duration of work.
 */
export declare class WorkerPool {
  constructor(file: string | URL, count: number);
  /** Queue one task against an idle worker. Resolves with the worker's
   * reply message (matched by `task.id`). */
  dispatch<T = unknown>(task: unknown): Promise<T>;
  /** Terminate every worker. Pending and queued tasks reject. */
  close(): Promise<void>;
}
