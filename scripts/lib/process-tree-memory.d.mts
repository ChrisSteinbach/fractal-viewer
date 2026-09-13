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

/** One timeline observation: an RSS snapshot beside the run's own progress. */
export interface ProcessTreeRssTimelineSample {
  atMs: number;
  stage: string | null;
  completedTiles?: number | null;
  [key: string]: unknown;
}

export interface ProcessTreeRssPhase {
  stage: string;
  samples: number;
  firstAtMs: number | null;
  lastAtMs: number | null;
  status: ProcessTreeMemoryStatus;
  /** Exact only when every sample in the phase was complete. */
  rssStartBytes: number | null;
  rssEndBytes: number | null;
  rssMaxBytes: number | null;
  /** Largest readable-tree totals, lower bounds when status is partial. */
  knownRssStartBytes: number | null;
  knownRssEndBytes: number | null;
  knownRssMaxBytes: number | null;
}

export interface ProcessTreeRssTimelineAttribution {
  sampleCount: number;
  completeSampleCount: number;
  status: ProcessTreeMemoryStatus;
  baselineRssBytes: number | null;
  peakRssBytes: number | null;
  knownBaselineRssBytes: number | null;
  knownPeakRssBytes: number | null;
  phases: ProcessTreeRssPhase[];
  renderTileBands: ProcessTreeRssPhase[] | null;
}

export declare const DEFAULT_TIMELINE_BANDS: number;

export declare function attributeProcessTreeRssTimeline(
  samples: ProcessTreeRssTimelineSample[],
  options?: { renderTileBands?: number },
): ProcessTreeRssTimelineAttribution;
