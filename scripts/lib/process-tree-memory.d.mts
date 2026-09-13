/** Types for the Linux `/proc` process-tree RSS sampler. */

export type ProcessTreeMemoryStatus = "ok" | "partial" | "unknown";

export interface ProcessTreeMemoryIssue {
  pid: number;
  path: string;
  reason: string;
}

export interface ProcessTreeRssSample {
  rootPid: number;
  /** `rssBytes` is populated only for a complete snapshot. */
  status: ProcessTreeMemoryStatus;
  rssBytes: number | null;
  /** Sum of readable tree members; a lower bound when status is partial. */
  knownRssBytes: number | null;
  sampledPids: number[];
  unavailableProcessCount: number;
  issues: ProcessTreeMemoryIssue[];
}

export interface ProcessTreeRssPeak {
  rootPid: number;
  status: ProcessTreeMemoryStatus;
  /** Present only when every sample was complete. */
  peakRssBytes: number | null;
  /** Largest readable-tree total, a lower bound for incomplete runs. */
  knownPeakRssBytes: number | null;
  intervalMs: number;
  startedAtMs: number;
  endedAtMs: number;
  sampleCount: number;
  completeSampleCount: number;
  partialSampleCount: number;
  unknownSampleCount: number;
  issues: ProcessTreeMemoryIssue[];
}

export declare const DEFAULT_PEAK_INTERVAL_MS: number;

export declare function parseProcStatus(text: string): {
  ppid: number | null;
  rssBytes: number | null;
} | null;

export declare function sampleProcessTreeRss(
  rootPid: number,
): Promise<ProcessTreeRssSample>;

export declare function sampleProcessTreeRssPeak<T>(
  rootPid: number,
  operation: () => Promise<T> | T,
  options?: { intervalMs?: number; initialSample?: ProcessTreeRssSample },
): Promise<{ value: T; peak: ProcessTreeRssPeak }>;
