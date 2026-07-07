import {
  MAX_RECORDING_SECONDS,
  formatElapsed,
  pickRecorderMime,
  recordingBitsPerSecond,
  recordingFileName,
  videoCaptureSupported,
} from "./recorder";

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
