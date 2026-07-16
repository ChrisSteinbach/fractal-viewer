// Records the visible WebGL canvas to a downloadable video clip via
// canvas.captureStream() + MediaRecorder — no dependencies. All three render
// modes (points/4D, flame, voxel) draw onto the same canvas, so one recorder
// covers them all. The pure helpers (mime choice, bitrate, naming, elapsed
// formatting) are unit-tested; the MediaRecorder glue is verified in-browser.
//
// Primary use case: short clips of the 4D auto-tumble for social posts, so
// MP4/H.264 is strongly preferred (X rejects WebM uploads); WebM is the
// fallback for browsers that cannot record MP4 (e.g. Firefox).

import { patchMp4Duration } from "./mp4-duration";
import { patchWebmDuration } from "./webm-duration";

/** Hard cap on clip length. X's free tier allows 140s; Bluesky less. */
export const MAX_RECORDING_SECONDS = 120;

/** Container/codec preference: MP4 first for social-media compatibility. */
const MIME_PREFERENCE = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** First mime type the recorder supports, or undefined when none are. */
export function pickRecorderMime(
  isSupported: (mime: string) => boolean,
): string | undefined {
  return MIME_PREFERENCE.find(isSupported);
}

/**
 * Target encoder bitrate: ~0.08 bits per pixel per frame at `fps` (the
 * MediaRecorder capture path assumes its 60Hz default; the offline
 * frame-exact export passes its own rate, fr-92t9), clamped to [8, 30] Mbps.
 * Point clouds are high-frequency content that browser default bitrates
 * smear badly; upload targets re-encode anyway, so erring high costs only
 * local file size.
 */
export function recordingBitsPerSecond(
  width: number,
  height: number,
  fps = 60,
): number {
  const target = Math.round(width * height * fps * 0.08);
  return Math.min(Math.max(target, 8_000_000), 30_000_000);
}

/** fractal-<timestamp>.<ext>, matching the Save PNG naming convention. */
export function recordingFileName(mime: string, timestampMs: number): string {
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  return `fractal-${String(timestampMs)}.${ext}`;
}

/** Whole seconds → "m:ss" for the recording button label. */
export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

/** True when this browser can record the canvas to a supported container. */
export function videoCaptureSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickRecorderMime((mime) => MediaRecorder.isTypeSupported(mime)) !==
      undefined
  );
}

export interface CanvasRecorderCallbacks {
  /** Fires with true on start, false once the clip is finalized or aborted. */
  onStateChange: (recording: boolean) => void;
  /** Fires roughly once per second with whole elapsed seconds. */
  onTick: (elapsedSeconds: number) => void;
  /** Recording failed or produced nothing; the recorder already cleaned up. */
  onError: (message: string) => void;
}

export interface CanvasRecorder {
  readonly recording: boolean;
  /** Start when idle; stop (finalize + download the clip) when recording. */
  toggle: () => void;
  stop: () => void;
}

export function createCanvasRecorder(
  canvas: HTMLCanvasElement,
  callbacks: CanvasRecorderCallbacks,
): CanvasRecorder {
  let recorder: MediaRecorder | undefined;
  let chunks: Blob[] = [];
  let startedAtMs = 0;
  let stoppedElapsedMs = 0;
  let errored = false;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  // A hidden tab pauses requestAnimationFrame, so the stream would stall
  // while wall-clock time kept accruing; stop cleanly instead.
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") stop();
  };
  // Resizing the canvas mid-stream changes the encoded resolution, which
  // muxers and players handle badly; stop cleanly instead.
  const onResize = (): void => {
    stop();
  };

  function cleanup(): void {
    if (tickTimer !== undefined) clearInterval(tickTimer);
    tickTimer = undefined;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("resize", onResize);
    if (recorder !== undefined) {
      for (const track of recorder.stream.getTracks()) track.stop();
    }
    recorder = undefined;
    chunks = [];
  }

  function start(): void {
    if (recorder !== undefined) return;
    const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    if (!videoCaptureSupported() || mime === undefined) {
      callbacks.onError("Video recording is not supported in this browser.");
      return;
    }
    let rec: MediaRecorder;
    try {
      const stream = canvas.captureStream();
      rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: recordingBitsPerSecond(canvas.width, canvas.height),
      });
    } catch (err) {
      callbacks.onError(`Could not start recording: ${String(err)}`);
      return;
    }
    recorder = rec;
    errored = false;
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    rec.onerror = () => {
      // Per spec the recorder inactivates itself and still fires "stop",
      // where finalize() discards the clip because of this flag.
      errored = true;
    };
    rec.onstop = () => {
      finalize(mime);
    };
    try {
      rec.start(1000);
    } catch (err) {
      // cleanup() resets `recorder` so a failed start cannot wedge the
      // toggle in a permanent "recording" state.
      cleanup();
      callbacks.onError(`Could not start recording: ${String(err)}`);
      return;
    }
    startedAtMs = performance.now();
    tickTimer = setInterval(() => {
      const elapsed = Math.round((performance.now() - startedAtMs) / 1000);
      callbacks.onTick(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) stop();
    }, 1000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("resize", onResize);
    callbacks.onStateChange(true);
  }

  function finalize(mime: string): void {
    const blob = new Blob(chunks, { type: mime });
    const filename = recordingFileName(mime, Date.now());
    const failed = errored;
    cleanup();
    if (failed) {
      callbacks.onError("Recording failed; the clip was discarded.");
    } else if (blob.size === 0) {
      callbacks.onError("Recording produced no data.");
    } else {
      void finishClip(blob, filename, mime, stoppedElapsedMs);
    }
    callbacks.onStateChange(false);
  }

  function stop(): void {
    if (recorder === undefined || recorder.state === "inactive") return;
    stoppedElapsedMs = performance.now() - startedAtMs;
    recorder.stop(); // "stop" event finalizes, downloads, and cleans up.
  }

  return {
    get recording(): boolean {
      return recorder !== undefined;
    },
    toggle(): void {
      if (recorder !== undefined) {
        stop();
      } else {
        start();
      }
    },
    stop,
  };
}

async function finishClip(
  blob: Blob,
  filename: string,
  mime: string,
  durationMs: number,
): Promise<void> {
  let clip = blob;
  try {
    // MediaRecorder streams the container out before the clip's length is
    // known, so both muxers leave broken duration metadata that upload
    // probes (e.g. Bluesky's) reject: Chrome's fragmented MP4 keeps the
    // moov durations at 0 (fr-ex2) and WebM ships a zero or missing
    // Segment Info Duration (fr-87q). Write the real wall-clock duration
    // into the container before handing the file over.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (mime.startsWith("video/mp4")) {
      if (patchMp4Duration(bytes, durationMs)) {
        clip = new Blob([bytes], { type: mime });
      }
    } else if (mime.startsWith("video/webm")) {
      const patched = patchWebmDuration(bytes, durationMs);
      if (patched !== undefined) {
        clip = new Blob([patched], { type: mime });
      }
    }
  } catch {
    // Keep the unpatched clip rather than losing the recording.
  }
  downloadBlob(clip, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Give the download time to begin before releasing the blob URL.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
