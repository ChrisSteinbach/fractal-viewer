/**
 * The offline export's WebCodecs encode session (fr-92t9): each frame the
 * driver loop (`offline-export.ts`) finishes painting is read off the shared
 * canvas as a `VideoFrame`, handed to an H.264 `VideoEncoder`, and collected
 * as a per-chunk Blob + `mp4-mux.ts` sample row; `finish()` flushes the
 * encoder and assembles the final MP4 as `Blob([header, ...chunkBlobs])`, so
 * the encoded bytes are never concatenated in JS memory — a two-minute clip
 * stays a list of small Blobs until the download materializes it.
 *
 * MP4/H.264 only, same rationale as `recorder.ts`'s mime preference: the
 * clips exist to be uploaded, and X rejects WebM. A browser that can't
 * encode H.264 (or has no `VideoEncoder` at all) simply reports itself
 * unsupported here and the export falls back to the realtime MediaRecorder
 * capture — the offline path is an upgrade, never a gatekeeper.
 *
 * The encoder is configured with `avc: { format: "avc" }`, so chunks arrive
 * length-prefixed (MP4's sample format) and the first chunk's
 * `decoderConfig.description` IS the avcC record the muxer embeds — no
 * bitstream parsing anywhere. Timestamps are authored (`frameTimestampUs`),
 * and the session asserts they come back monotonic: the uniform-delta `stts`
 * the muxer writes cannot represent B-frame reordering, so an encoder that
 * reorders (none of the browser encoders we target do) fails the export
 * honestly instead of producing a stuttering file.
 *
 * Like `recorder.ts`, the `VideoEncoder` glue is verified in-browser; the
 * pure pieces (level ladder, codec candidates, even-dimension crop,
 * timestamp/keyframe math) are unit-tested.
 */
import { buildMp4Header, type Mp4Sample } from "./mp4-mux";
import { recordingBitsPerSecond } from "./recorder";

/** Keyframe cadence in seconds: seekability + error recovery without
 * spending bitrate on constant IDRs. */
const KEYFRAME_INTERVAL_S = 2;

/** Encoder queue depth the per-frame backpressure drains to. Small enough
 * to bound VideoFrame memory (each holds a canvas-sized bitmap), large
 * enough to keep a hardware encoder's pipeline busy. */
const MAX_ENCODE_QUEUE = 2;

/** True when this browser has the WebCodecs surface the offline export
 * needs — the cheap synchronous probe that decides whether the Export
 * button should even try the offline path (`createOfflineEncoder`'s async
 * `isConfigSupported` probe is the real gate). */
export function offlineExportSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
  );
}

/** H.264 encoders take even dimensions; a canvas can be odd (device-pixel
 * rounding). The frame is cropped, never scaled — at most one row/column of
 * pixels is shaved off the bottom/right edge. */
export function evenDims(
  width: number,
  height: number,
): { width: number; height: number } {
  return { width: Math.max(2, width & ~1), height: Math.max(2, height & ~1) };
}

/** The H.264 level ladder (Annex A tables): level_idc with its macroblock
 * throughput (MaxMBPS) and frame-size (MaxFS) limits. Ascending, so the
 * first row that fits is the smallest honest level. */
const H264_LEVELS: readonly {
  idc: number;
  maxMbPerSec: number;
  maxMbPerFrame: number;
}[] = [
  { idc: 0x1f, maxMbPerSec: 108_000, maxMbPerFrame: 3_600 }, // 3.1
  { idc: 0x20, maxMbPerSec: 216_000, maxMbPerFrame: 5_120 }, // 3.2
  { idc: 0x28, maxMbPerSec: 245_760, maxMbPerFrame: 8_192 }, // 4.0 (1080p30)
  { idc: 0x2a, maxMbPerSec: 522_240, maxMbPerFrame: 8_704 }, // 4.2 (1080p60)
  { idc: 0x32, maxMbPerSec: 589_824, maxMbPerFrame: 22_080 }, // 5.0
  { idc: 0x33, maxMbPerSec: 983_040, maxMbPerFrame: 36_864 }, // 5.1 (4K30)
  { idc: 0x34, maxMbPerSec: 2_073_600, maxMbPerFrame: 36_864 }, // 5.2 (4K60)
];

/**
 * Codec strings to probe for `width`×`height` at `fps`, preferred first:
 * High, then Main, then Constrained Baseline profile, each at the smallest
 * level whose macroblock limits fit the frames. Empty when even level 5.2
 * can't hold them (an 8K canvas — nothing we can honestly encode).
 */
export function h264CodecCandidates(
  width: number,
  height: number,
  fps: number,
): string[] {
  const mbPerFrame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = H264_LEVELS.find(
    (l) => mbPerFrame <= l.maxMbPerFrame && mbPerFrame * fps <= l.maxMbPerSec,
  );
  if (level === undefined) return [];
  const hex = level.idc.toString(16).padStart(2, "0");
  return [`avc1.6400${hex}`, `avc1.4d00${hex}`, `avc1.42e0${hex}`];
}

/** Frame `index`'s presentation timestamp in microseconds — authored
 * arithmetic, the same virtual-clock stance as the driver loop. */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps);
}

/** Whether frame `index` should be forced to an IDR keyframe — frame 0 and
 * every {@link KEYFRAME_INTERVAL_S} seconds after. */
export function isKeyFrameIndex(index: number, fps: number): boolean {
  return index % (fps * KEYFRAME_INTERVAL_S) === 0;
}

export interface OfflineEncoderSession {
  /** Encode the just-painted canvas as frame `index`. Resolves once the
   * encoder has accepted it and its queue is back under the backpressure
   * bound; rejects when the encoder has failed (the export aborts). */
  encodeFrame(canvas: HTMLCanvasElement, index: number): Promise<void>;
  /** Flush the encoder and assemble the MP4. `null` when the session
   * failed or produced nothing — {@link error} says which. */
  finish(): Promise<Blob | null>;
  /** Drop everything (encoder error / export exception cleanup). */
  abort(): void;
  /** The first failure's human-readable reason, or null. */
  readonly error: string | null;
}

/**
 * Probe for an H.264 encoder that can take `width`×`height`@`fps` frames
 * and open a session on it. Resolves `null` when WebCodecs is missing or no
 * candidate config is supported — the caller falls back to the realtime
 * capture. The session encodes at the even-cropped dimensions; odd canvases
 * are cropped per frame via `visibleRect`.
 */
export async function createOfflineEncoder(opts: {
  width: number;
  height: number;
  fps: number;
}): Promise<OfflineEncoderSession | null> {
  if (!offlineExportSupported()) return null;
  const { width, height } = evenDims(opts.width, opts.height);
  const { fps } = opts;
  let config: VideoEncoderConfig | null = null;
  for (const codec of h264CodecCandidates(width, height, fps)) {
    const candidate: VideoEncoderConfig = {
      codec,
      width,
      height,
      framerate: fps,
      bitrate: recordingBitsPerSecond(width, height, fps),
      // Length-prefixed samples + out-of-band avcC — MP4's native shape.
      avc: { format: "avc" },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(candidate);
      if (support.supported === true) {
        config = candidate;
        break;
      }
    } catch {
      // An unparseable codec string rejects rather than reporting
      // unsupported — treat it the same and try the next candidate.
    }
  }
  if (config === null) return null;

  const samples: Mp4Sample[] = [];
  const parts: Blob[] = [];
  let avcC: Uint8Array | null = null;
  let lastTimestamp = -1;
  let error: string | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const description = metadata?.decoderConfig?.description;
      if (avcC === null && description !== undefined) {
        // Copy: the encoder may reuse its buffer, and the muxer embeds
        // these bytes verbatim at finish time.
        avcC = ArrayBuffer.isView(description)
          ? new Uint8Array(
              description.buffer.slice(
                description.byteOffset,
                description.byteOffset + description.byteLength,
              ),
            )
          : new Uint8Array(description.slice(0));
      }
      if (chunk.timestamp <= lastTimestamp) {
        // B-frame reordering — see the module header. First failure wins.
        error ??=
          "encoder reordered frames (B-frames), which the exporter cannot mux";
        return;
      }
      lastTimestamp = chunk.timestamp;
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      parts.push(new Blob([bytes]));
      samples.push({ size: chunk.byteLength, keyframe: chunk.type === "key" });
    },
    error: (e) => {
      error ??= e.message;
    },
  });
  encoder.configure(config);

  const whenDequeued = (): Promise<void> =>
    new Promise((resolve) => {
      encoder.addEventListener("dequeue", () => resolve(), { once: true });
    });

  return {
    get error(): string | null {
      return error;
    },
    async encodeFrame(canvas: HTMLCanvasElement, index: number): Promise<void> {
      if (error !== null || encoder.state === "closed") {
        throw new Error(error ?? "encoder closed");
      }
      let frame = new VideoFrame(canvas, {
        timestamp: frameTimestampUs(index, fps),
        duration:
          frameTimestampUs(index + 1, fps) - frameTimestampUs(index, fps),
      });
      if (frame.codedWidth !== width || frame.codedHeight !== height) {
        // Odd canvas: crop to the configured even dimensions (or fail
        // upstream if the canvas resized — the export stops on resize, but
        // a racing frame must not feed the encoder mismatched sizes).
        const cropped = new VideoFrame(frame, {
          visibleRect: { x: 0, y: 0, width, height },
        });
        frame.close();
        frame = cropped;
      }
      try {
        encoder.encode(frame, { keyFrame: isKeyFrameIndex(index, fps) });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
        await whenDequeued();
      }
      if (error !== null) throw new Error(error);
    },
    async finish(): Promise<Blob | null> {
      try {
        if (encoder.state !== "closed") {
          await encoder.flush();
          encoder.close();
        }
      } catch (e) {
        error ??= String(e);
      }
      if (error !== null || avcC === null || samples.length === 0) {
        return null;
      }
      const header = buildMp4Header({ width, height, fps, avcC, samples });
      return new Blob([header, ...parts], { type: "video/mp4" });
    },
    abort(): void {
      if (encoder.state !== "closed") encoder.close();
      parts.length = 0;
      samples.length = 0;
    },
  };
}
