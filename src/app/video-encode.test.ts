import {
  evenDims,
  frameTimestampUs,
  h264CodecCandidates,
  isKeyFrameIndex,
  offlineExportSupported,
} from "./video-encode";

describe("offlineExportSupported", () => {
  it("is false where WebCodecs is absent (this test environment)", () => {
    expect(offlineExportSupported()).toBe(false);
  });
});

describe("evenDims", () => {
  it("passes even dimensions through unchanged", () => {
    expect(evenDims(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("floors odd dimensions to even (a crop, never a scale)", () => {
    expect(evenDims(1001, 701)).toEqual({ width: 1000, height: 700 });
  });

  it("never collapses below 2×2", () => {
    expect(evenDims(1, 0)).toEqual({ width: 2, height: 2 });
  });
});

describe("h264CodecCandidates", () => {
  it("offers High, Main, and Constrained Baseline at one shared level", () => {
    const candidates = h264CodecCandidates(1280, 720, 30);
    expect(candidates).toEqual(["avc1.64001f", "avc1.4d001f", "avc1.42e01f"]);
  });

  it("picks level 4.0 for 1080p30 (8160 macroblocks just fits MaxFS 8192)", () => {
    expect(h264CodecCandidates(1920, 1080, 30)[0]).toBe("avc1.640028");
  });

  it("steps up to level 4.2 for 1080p60 (throughput, not frame size)", () => {
    expect(h264CodecCandidates(1920, 1080, 60)[0]).toBe("avc1.64002a");
  });

  it("reaches level 5.1 for a 4K canvas at 30fps", () => {
    expect(h264CodecCandidates(3840, 2160, 30)[0]).toBe("avc1.640033");
  });

  it("returns no candidates when even level 5.2 cannot hold the frames", () => {
    expect(h264CodecCandidates(7680, 4320, 60)).toEqual([]);
  });
});

describe("frameTimestampUs", () => {
  it("authors microsecond timestamps as exact frame arithmetic", () => {
    expect(frameTimestampUs(0, 30)).toBe(0);
    expect(frameTimestampUs(1, 30)).toBe(33333);
    expect(frameTimestampUs(30, 30)).toBe(1_000_000);
  });

  it("stays monotonically increasing across rounding boundaries", () => {
    let last = -1;
    for (let i = 0; i < 300; i++) {
      const ts = frameTimestampUs(i, 30);
      expect(ts).toBeGreaterThan(last);
      last = ts;
    }
  });
});

describe("isKeyFrameIndex", () => {
  it("forces an IDR on frame 0 and every 2 seconds after", () => {
    expect(isKeyFrameIndex(0, 30)).toBe(true);
    expect(isKeyFrameIndex(59, 30)).toBe(false);
    expect(isKeyFrameIndex(60, 30)).toBe(true);
    expect(isKeyFrameIndex(61, 30)).toBe(false);
  });
});
