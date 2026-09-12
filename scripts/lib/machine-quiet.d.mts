/**
 * Types for `machine-quiet.mjs`, so the TS harness sheet that imports it
 * (surface-lighting-agreement.harness.ts) gets real ones instead of `any` —
 * the .mjs is checked by `tsc -p scripts` but inferred only loosely under
 * eslint's project service. Keep in step with the implementation's doc.
 */

export interface QuietProcessRow {
  pid: number;
  comm: string;
  busyMsPerSecond: number;
}

export interface QuietResult {
  /** true / false / null for UNKNOWN — never read null as quiet. */
  contended: boolean | null;
  unknownReason: string | null;
  others: QuietProcessRow[];
  ignored: QuietProcessRow[];
  competing: QuietProcessRow[];
  gpuBusyPercent: number | null;
  loadavg1: number;
  windowMs: number;
  thresholdMsPerSecond: number;
}

export declare const CONTENTION_MS_PER_SECOND: number;
export declare const DESKTOP_COMMS: readonly string[];

/** One fdinfo file's contents → `{ driver, clientId, busyNs }`, or `null`. */
export declare function parseFdinfo(text: string): {
  driver: string;
  clientId: string | null;
  busyNs: number;
  sawEngine: boolean;
} | null;

export declare function sampleDrmClients(): Promise<
  Map<number, { comm: string; busyNs: number }>
>;

export declare function pidTree(rootPid: number): Promise<Set<number>>;

export declare function classifyContention(
  before: Map<number, { comm: string; busyNs: number }>,
  after: Map<number, { comm: string; busyNs: number }>,
  options?: {
    windowMs?: number;
    ignorePids?: number[];
    ignoreComms?: string[];
    thresholdMsPerSecond?: number;
  },
): {
  others: QuietProcessRow[];
  ignored: QuietProcessRow[];
  competing: QuietProcessRow[];
  contended: boolean;
};

export declare function readGpuBusyPercent(): Promise<number | null>;

export declare function measureGpuContention(options?: {
  windowMs?: number;
  ignorePids?: number[];
  ignoreComms?: string[];
  thresholdMsPerSecond?: number;
}): Promise<QuietResult>;

export declare function formatQuietLine(result: QuietResult): string;

/** Take the pre-browser contention baseline and log it. NEVER THROWS. */
export declare function quietBaseline(
  log: (line: string) => void,
  options?: {
    windowMs?: number;
    ignorePids?: number[];
    ignoreComms?: string[];
    thresholdMsPerSecond?: number;
  },
): Promise<QuietResult>;

/**
 * The stamped reason a contended baseline refuses a measurement, or `null`
 * when the machine was quiet or UNKNOWN (which proceeds, loudly).
 */
export declare function contendedReason(quiet: QuietResult): string | null;
