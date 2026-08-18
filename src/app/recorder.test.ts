import {
  MAX_RECORDING_SECONDS,
  createCanvasRecorder,
  formatElapsed,
  pickRecorderMime,
  recordingBitsPerSecond,
  recordingFileName,
  videoCaptureSupported,
} from "./recorder";
import { patchMp4Duration } from "./mp4-duration";

// The duration finalize() settles on is observable only at the container
// patch, so the MP4 patcher (the mime the stubs pick) is mocked to capture
// what would be stamped into the file. Only the createCanvasRecorder tests
// reach it.
vi.mock("./mp4-duration", () => ({ patchMp4Duration: vi.fn(() => false) }));

describe("pickRecorderMime", () => {
  it("prefers MP4/avc1 when every mime is supported, since X rejects WebM uploads", () => {
    expect(pickRecorderMime(() => true)).toBe("video/mp4;codecs=avc1");
  });

  it("falls through to the first supported WebM codec when MP4 is unsupported", () => {
    expect(pickRecorderMime((m) => m.startsWith("video/webm"))).toBe(
      "video/webm;codecs=vp9",
    );
  });

  it("returns plain video/mp4 when only the codec-less MP4 mime is supported", () => {
    expect(pickRecorderMime((m) => m === "video/mp4")).toBe("video/mp4");
  });

  it("falls back to plain video/webm as the last resort", () => {
    expect(pickRecorderMime((m) => m === "video/webm")).toBe("video/webm");
  });

  it("returns undefined when no mime is supported", () => {
    expect(pickRecorderMime(() => false)).toBeUndefined();
  });
});

describe("recordingBitsPerSecond", () => {
  it("targets ~0.08 bits/pixel/frame at 60fps for 1080p", () => {
    expect(recordingBitsPerSecond(1920, 1080)).toBe(9_953_280);
  });

  it("clamps small resolutions up to the 8 Mbps floor", () => {
    expect(recordingBitsPerSecond(640, 480)).toBe(8_000_000);
  });

  it("clamps large resolutions down to the 30 Mbps ceiling", () => {
    expect(recordingBitsPerSecond(3840, 2160)).toBe(30_000_000);
  });
});

describe("recordingFileName", () => {
  it("names MP4 clips fractal-<timestamp>.mp4", () => {
    expect(recordingFileName("video/mp4;codecs=avc1", 1234)).toBe(
      "fractal-1234.mp4",
    );
  });

  it("names WebM clips fractal-<timestamp>.webm", () => {
    expect(recordingFileName("video/webm;codecs=vp9", 1234)).toBe(
      "fractal-1234.webm",
    );
  });
});

describe("formatElapsed", () => {
  it("formats zero seconds as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("pads single-digit seconds within the first minute", () => {
    expect(formatElapsed(7)).toBe("0:07");
  });

  it("formats a minute and change as 1:05", () => {
    expect(formatElapsed(65)).toBe("1:05");
  });

  it("formats one second short of two minutes as 1:59", () => {
    expect(formatElapsed(119)).toBe("1:59");
  });

  it("rolls over to 2:00 at exactly 120 seconds", () => {
    expect(formatElapsed(120)).toBe("2:00");
  });
});

describe("videoCaptureSupported", () => {
  it("returns false in this Node environment, which has no MediaRecorder", () => {
    expect(videoCaptureSupported()).toBe(false);
  });
});

describe("MAX_RECORDING_SECONDS", () => {
  it("stays within X's 140s free-tier video length limit", () => {
    expect(MAX_RECORDING_SECONDS).toBeLessThanOrEqual(140);
  });
});

/** Everything createCanvasRecorder touches, stubbed for this Node
 * environment: a MediaRecorder class the caller supplies the behavior of, an
 * HTMLCanvasElement whose prototype satisfies videoCaptureSupported(), a
 * canvas whose captureStream() yields one stoppable track, and the
 * document/window listener + blob-download surfaces start() and finalize()
 * reach. Callers rely on the afterEach vi.unstubAllGlobals(). */
function stubRecordingGlobals(RecorderClass: unknown): {
  canvas: HTMLCanvasElement;
  track: { stop: ReturnType<typeof vi.fn> };
} {
  const track = { stop: vi.fn() };
  class FakeCanvasElement {
    captureStream(): void {}
  }
  vi.stubGlobal("MediaRecorder", RecorderClass);
  vi.stubGlobal("HTMLCanvasElement", FakeCanvasElement);
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createElement: () => ({ href: "", download: "", click: vi.fn() }),
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:mock",
    revokeObjectURL: vi.fn(),
  });
  const canvas = {
    width: 640,
    height: 480,
    captureStream: () => ({ getTracks: () => [track] }),
  } as unknown as HTMLCanvasElement;
  return { canvas, track };
}

/** A MediaRecorder whose lifecycle the test drives by hand: start() records,
 * stop() only inactivates — the test fires ondataavailable/onstop itself,
 * because in the real API "stop" arrives asynchronously and the gap between
 * stop() and "stop" is exactly what the duration tests exercise. */
class FakeMediaRecorder {
  static isTypeSupported = (): boolean => true;
  static last: FakeMediaRecorder | undefined;
  state = "inactive";
  stream: { getTracks: () => { stop: () => void }[] };
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(stream: { getTracks: () => { stop: () => void }[] }) {
    this.stream = stream;
    FakeMediaRecorder.last = this;
  }
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
  }
}

describe("createCanvasRecorder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(patchMp4Duration).mockClear();
  });

  it("stops the already-created capture track when the MediaRecorder constructor throws", () => {
    class ThrowingMediaRecorder {
      static isTypeSupported = (): boolean => true;
      constructor() {
        throw new Error("NotSupportedError");
      }
    }
    const { canvas, track } = stubRecordingGlobals(ThrowingMediaRecorder);
    const onError = vi.fn();
    const recorder = createCanvasRecorder(canvas, {
      onStateChange: vi.fn(),
      onTick: vi.fn(),
      onError,
    });

    recorder.toggle();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Could not start recording"),
    );
    expect(recorder.recording).toBe(false);
  });

  it("derives the actual elapsed time when the recording stops spontaneously", async () => {
    const { canvas } = stubRecordingGlobals(FakeMediaRecorder);
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const recorder = createCanvasRecorder(canvas, {
      onStateChange: vi.fn(),
      onTick: vi.fn(),
      onError: vi.fn(),
    });

    recorder.toggle(); // starts the clock at t=1000ms
    FakeMediaRecorder.last?.ondataavailable?.({ data: new Blob(["frame"]) });
    now.mockReturnValue(6_000);
    FakeMediaRecorder.last?.onstop?.(); // the track ended; nobody called stop()

    await vi.waitFor(() => {
      expect(patchMp4Duration).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        5_000,
      );
    });
  });

  it("keeps the elapsed time stop() recorded, not the later moment 'stop' fires", async () => {
    const { canvas } = stubRecordingGlobals(FakeMediaRecorder);
    const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const recorder = createCanvasRecorder(canvas, {
      onStateChange: vi.fn(),
      onTick: vi.fn(),
      onError: vi.fn(),
    });

    recorder.toggle(); // starts the clock at t=1000ms
    FakeMediaRecorder.last?.ondataavailable?.({ data: new Blob(["frame"]) });
    now.mockReturnValue(4_000);
    recorder.stop(); // the user pressed stop at 3000ms elapsed
    now.mockReturnValue(9_000);
    FakeMediaRecorder.last?.onstop?.(); // "stop" arrives late, as it really does

    await vi.waitFor(() => {
      expect(patchMp4Duration).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        3_000,
      );
    });
  });
});
