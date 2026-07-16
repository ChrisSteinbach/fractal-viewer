import { buildMp4Header } from "./mp4-mux";
import { patchMp4Duration } from "./mp4-duration";

// ---------------------------------------------------------------------------
// Local box-walking helpers — independent of mp4-mux.ts's own internals, so
// a bug in its offset bookkeeping can't hide from these tests. Compact
// (u32) box sizes only: sufficient for parsing this module's own output.
// ---------------------------------------------------------------------------

/** Read one box's declared size + 4-char type at `offset` within `bytes`. */
function readBoxHeader(
  bytes: Uint8Array,
  offset: number,
): { size: number; type: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    size: view.getUint32(offset),
    type: String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    ),
  };
}

interface FoundBox {
  /** Offset of the box's first payload byte (just past its 8-byte header). */
  payloadStart: number;
  /** The box's own declared total size (header + payload). */
  size: number;
}

/**
 * Byte length of fixed, non-box content that precedes a box's first NESTED
 * child box — zero for the plain containers this file descends into
 * (moov/trak/mdia/minf/stbl/edts), whose payload is nothing but a
 * back-to-back sequence of child boxes. stsd is a FullBox with a
 * version/flags(4) + entry_count(4) header before its sample entries; avc1
 * (a VisualSampleEntry) has 78 bytes of fixed video fields before its avcC
 * child. Without this, scanning for a child would start mid-field and
 * misread a fixed-field byte pattern as a bogus (usually zero-size) box
 * header.
 */
const CHILD_BOX_PREFIX: Record<string, number> = {
  stsd: 8,
  avc1: 78,
};

/**
 * Walk a path of box types (e.g. ["moov","trak","mdia"]) starting from the
 * top level of `bytes`, descending into each match's payload for the next
 * segment. Throws when a segment can't be found, or when a box's declared
 * size couldn't possibly be real (< 8, the smallest legal box) — tests want
 * a loud failure pointing at the bad box, not an offset that never advances.
 */
function findBox(bytes: Uint8Array, path: readonly string[]): FoundBox {
  let start = 0;
  let end = bytes.byteLength;
  let found: FoundBox | undefined;
  for (const type of path) {
    found = undefined;
    let offset = start;
    while (offset + 8 <= end) {
      const header = readBoxHeader(bytes, offset);
      if (header.size < 8) {
        throw new Error(
          `invalid box size ${header.size} at offset ${offset} while scanning for "${type}"`,
        );
      }
      if (header.type === type) {
        found = { payloadStart: offset + 8, size: header.size };
        break;
      }
      offset += header.size;
    }
    if (found === undefined) {
      throw new Error(`box not found: ${path.join(" > ")} (missing "${type}")`);
    }
    start = found.payloadStart + (CHILD_BOX_PREFIX[type] ?? 0);
    end = found.payloadStart + found.size - 8;
  }
  if (found === undefined) throw new Error("empty path");
  return found;
}

/** A DataView over exactly a found box's payload (header stripped). */
function payloadView(bytes: Uint8Array, found: FoundBox): DataView {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + found.payloadStart,
    found.size - 8,
  );
}

const STBL_PATH = ["moov", "trak", "mdia", "minf", "stbl"];

/** The authored 30fps presentation grid, µs — what a never-reordering
 * encoder (Chrome) echoes back in decode order. */
function gridUs(index: number, fps = 30): number {
  return Math.round((index * 1_000_000) / fps);
}

describe("buildMp4Header", () => {
  it("lays out ftyp, then moov, then the mdat header, with sizes matching the actual layout", () => {
    const header = buildMp4Header({
      width: 640,
      height: 480,
      fps: 30,
      avcC: Uint8Array.from([1, 2, 3, 4]),
      samples: [
        { size: 100, keyframe: true, timestampUs: gridUs(0) },
        { size: 200, keyframe: false, timestampUs: gridUs(1) },
        { size: 150, keyframe: true, timestampUs: gridUs(2) },
      ],
    });

    const ftyp = readBoxHeader(header, 0);
    expect(ftyp.type).toBe("ftyp");

    const moov = readBoxHeader(header, ftyp.size);
    expect(moov.type).toBe("moov");

    const mdat = readBoxHeader(header, ftyp.size + moov.size);
    expect(mdat.type).toBe("mdat");

    expect(header.length).toBe(ftyp.size + moov.size + 8);
  });

  it("points stco's one chunk offset at the first sample's byte position (the header's own length)", () => {
    const header = buildMp4Header({
      width: 320,
      height: 240,
      fps: 30,
      avcC: Uint8Array.from([9]),
      samples: [
        { size: 10, keyframe: true, timestampUs: gridUs(0) },
        { size: 20, keyframe: false, timestampUs: gridUs(1) },
        { size: 30, keyframe: false, timestampUs: gridUs(2) },
      ],
    });

    const stco = payloadView(header, findBox(header, [...STBL_PATH, "stco"]));
    expect(stco.getUint32(4)).toBe(1); // entry_count
    expect(stco.getUint32(8)).toBe(header.length); // chunk_offset
  });

  it("declares mdat's size as 8 plus the sum of every sample's size", () => {
    const header = buildMp4Header({
      width: 100,
      height: 100,
      fps: 24,
      avcC: Uint8Array.from([0]),
      samples: [
        { size: 111, keyframe: true, timestampUs: gridUs(0, 24) },
        { size: 222, keyframe: false, timestampUs: gridUs(1, 24) },
        { size: 333, keyframe: false, timestampUs: gridUs(2, 24) },
        { size: 444, keyframe: true, timestampUs: gridUs(3, 24) },
        { size: 555, keyframe: false, timestampUs: gridUs(4, 24) },
      ],
    });

    const ftyp = readBoxHeader(header, 0);
    const moov = readBoxHeader(header, ftyp.size);
    const mdat = readBoxHeader(header, ftyp.size + moov.size);

    expect(mdat.size).toBe(8 + 111 + 222 + 333 + 444 + 555);
  });

  it("stsz lists each sample's size in order, with sample_size 0 and the right count", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 1000, keyframe: true, timestampUs: gridUs(0) },
        { size: 2000, keyframe: false, timestampUs: gridUs(1) },
        { size: 1500, keyframe: false, timestampUs: gridUs(2) },
      ],
    });

    const stsz = payloadView(header, findBox(header, [...STBL_PATH, "stsz"]));
    expect(stsz.getUint32(4)).toBe(0); // sample_size
    expect(stsz.getUint32(8)).toBe(3); // sample_count
    expect(stsz.getUint32(12)).toBe(1000);
    expect(stsz.getUint32(16)).toBe(2000);
    expect(stsz.getUint32(20)).toBe(1500);
  });

  it("stss lists the 1-based indices of keyframe samples", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 10, keyframe: true, timestampUs: gridUs(0) },
        { size: 10, keyframe: false, timestampUs: gridUs(1) },
        { size: 10, keyframe: true, timestampUs: gridUs(2) },
      ],
    });

    const stss = payloadView(header, findBox(header, [...STBL_PATH, "stss"]));
    expect(stss.getUint32(4)).toBe(2); // entry_count
    expect(stss.getUint32(8)).toBe(1);
    expect(stss.getUint32(12)).toBe(3);
  });

  it("stts holds one entry of {sampleCount, delta} at a 3000-unit delta for 30fps", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 1, keyframe: true, timestampUs: gridUs(0) },
        { size: 1, keyframe: false, timestampUs: gridUs(1) },
      ],
    });

    const stts = payloadView(header, findBox(header, [...STBL_PATH, "stts"]));
    expect(stts.getUint32(4)).toBe(1); // entry_count
    expect(stts.getUint32(8)).toBe(2); // sample_count
    expect(stts.getUint32(12)).toBe(3000); // sample_delta
  });

  it("stts uses a 1500-unit delta for 60fps", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 60,
      avcC: Uint8Array.from([1]),
      samples: [{ size: 1, keyframe: true, timestampUs: gridUs(0, 60) }],
    });

    const stts = payloadView(header, findBox(header, [...STBL_PATH, "stts"]));
    expect(stts.getUint32(12)).toBe(1500); // sample_delta
  });

  it("mvhd, tkhd, and mdhd all report the same duration, and both timescales read 90000", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 1, keyframe: true, timestampUs: gridUs(0) },
        { size: 1, keyframe: false, timestampUs: gridUs(1) },
        { size: 1, keyframe: false, timestampUs: gridUs(2) },
        { size: 1, keyframe: false, timestampUs: gridUs(3) },
      ],
    });
    const expectedDuration = 4 * 3000;

    const mvhd = payloadView(header, findBox(header, ["moov", "mvhd"]));
    expect(mvhd.getUint32(12)).toBe(90000); // timescale
    expect(mvhd.getUint32(16)).toBe(expectedDuration);

    const tkhd = payloadView(header, findBox(header, ["moov", "trak", "tkhd"]));
    expect(tkhd.getUint32(20)).toBe(expectedDuration);

    const mdhd = payloadView(
      header,
      findBox(header, ["moov", "trak", "mdia", "mdhd"]),
    );
    expect(mdhd.getUint32(12)).toBe(90000); // timescale
    expect(mdhd.getUint32(16)).toBe(expectedDuration);
  });

  it("embeds avcC verbatim, and matches width/height in avc1 (u16) and tkhd (16.16 fixed point)", () => {
    const avcC = Uint8Array.from([
      1, 100, 0, 31, 255, 225, 0, 5, 103, 66, 0, 31,
    ]);
    const header = buildMp4Header({
      width: 1280,
      height: 720,
      fps: 30,
      avcC,
      samples: [{ size: 10, keyframe: true, timestampUs: gridUs(0) }],
    });

    const avc1 = findBox(header, [...STBL_PATH, "stsd", "avc1"]);
    const avc1View = payloadView(header, avc1);
    expect(avc1View.getUint16(24)).toBe(1280); // width
    expect(avc1View.getUint16(26)).toBe(720); // height

    const avcCFound = findBox(header, [...STBL_PATH, "stsd", "avc1", "avcC"]);
    const avcCBytes = header.slice(
      avcCFound.payloadStart,
      avcCFound.payloadStart + (avcCFound.size - 8),
    );
    expect(avcCBytes).toEqual(avcC);

    const tkhd = payloadView(header, findBox(header, ["moov", "trak", "tkhd"]));
    expect(tkhd.getUint32(76)).toBe(1280 * 0x10000); // width, 16.16 fixed
    expect(tkhd.getUint32(80)).toBe(720 * 0x10000); // height, 16.16 fixed
  });

  it("produces a well-formed header for zero samples, with every sample table's entry_count at 0", () => {
    const header = buildMp4Header({
      width: 320,
      height: 240,
      fps: 30,
      avcC: Uint8Array.from([0]),
      samples: [],
    });

    const ftyp = readBoxHeader(header, 0);
    const moov = readBoxHeader(header, ftyp.size);
    const mdat = readBoxHeader(header, ftyp.size + moov.size);
    expect(mdat.type).toBe("mdat");
    expect(mdat.size).toBe(8);

    expect(
      payloadView(header, findBox(header, [...STBL_PATH, "stts"])).getUint32(4),
    ).toBe(0);
    expect(
      payloadView(header, findBox(header, [...STBL_PATH, "stss"])).getUint32(4),
    ).toBe(0);
    expect(
      payloadView(header, findBox(header, [...STBL_PATH, "stsc"])).getUint32(4),
    ).toBe(0);
    expect(
      payloadView(header, findBox(header, [...STBL_PATH, "stco"])).getUint32(4),
    ).toBe(0);
  });

  it("throws RangeError when the mdat payload would overflow a u32 box size", () => {
    const spec = {
      width: 2,
      height: 2,
      fps: 30,
      avcC: Uint8Array.from([0]),
      samples: [
        { size: 0x80000000, keyframe: true, timestampUs: gridUs(0) },
        { size: 0x80000000, keyframe: false, timestampUs: gridUs(1) },
      ],
    };

    expect(() => buildMp4Header(spec)).toThrow(RangeError);
  });

  it("produces a box tree patchMp4Duration can walk and patch", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 100, keyframe: true, timestampUs: gridUs(0) },
        { size: 100, keyframe: false, timestampUs: gridUs(1) },
      ],
    });

    expect(patchMp4Duration(header, 12345)).toBe(true);
  });

  // ── B-frame reordering (fr-7dm2) ─────────────────────────────────────
  // Firefox's H.264 encoder hands chunks back in decode order with
  // REORDERED presentation timestamps (an IPBB cadence), whatever
  // latencyMode asked. The observed pattern for the authored 30fps grid:
  // 0, +3 frames, +1, +2 — used verbatim below.

  it("writes no ctts and no edit list for a monotonic (never-reordered) stream", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 10, keyframe: true, timestampUs: gridUs(0) },
        { size: 10, keyframe: false, timestampUs: gridUs(1) },
        { size: 10, keyframe: false, timestampUs: gridUs(2) },
      ],
    });

    expect(() => findBox(header, [...STBL_PATH, "ctts"])).toThrow(
      /box not found/,
    );
    expect(() => findBox(header, ["moov", "trak", "edts"])).toThrow(
      /box not found/,
    );
  });

  it("represents a B-frame stream with run-length ctts offsets over synthesized decode times", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 10, keyframe: true, timestampUs: 0 },
        { size: 10, keyframe: false, timestampUs: 100000 },
        { size: 10, keyframe: false, timestampUs: 33333 },
        { size: 10, keyframe: false, timestampUs: 66667 },
      ],
    });

    // pts in ticks [0, 9000, 3000, 6000] against dts [0, 3000, 6000, 9000]:
    // raw offsets [0, +6000, -3000, -3000], biased by 3000 →
    // [3000, 9000, 0, 0] → three runs.
    const ctts = payloadView(header, findBox(header, [...STBL_PATH, "ctts"]));
    expect(ctts.getUint32(4)).toBe(3); // entry_count
    expect([ctts.getUint32(8), ctts.getUint32(12)]).toEqual([1, 3000]);
    expect([ctts.getUint32(16), ctts.getUint32(20)]).toEqual([1, 9000]);
    expect([ctts.getUint32(24), ctts.getUint32(28)]).toEqual([2, 0]);

    // stts stays the uniform decode cadence — reordering never touches it.
    const stts = payloadView(header, findBox(header, [...STBL_PATH, "stts"]));
    expect(stts.getUint32(8)).toBe(4); // sample_count
    expect(stts.getUint32(12)).toBe(3000); // sample_delta

    // The extra boxes must not desync the stco patch: the one chunk offset
    // still lands exactly at the header's end.
    const stco = payloadView(header, findBox(header, [...STBL_PATH, "stco"]));
    expect(stco.getUint32(8)).toBe(header.length);
  });

  it("trims a B-frame stream's shifted lead-in with an elst edit", () => {
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 10, keyframe: true, timestampUs: 0 },
        { size: 10, keyframe: false, timestampUs: 100000 },
        { size: 10, keyframe: false, timestampUs: 33333 },
        { size: 10, keyframe: false, timestampUs: 66667 },
      ],
    });

    const elst = payloadView(
      header,
      findBox(header, ["moov", "trak", "edts", "elst"]),
    );
    expect(elst.getUint32(4)).toBe(1); // entry_count
    expect(elst.getUint32(8)).toBe(4 * 3000); // segment_duration
    expect(elst.getUint32(12)).toBe(3000); // media_time: the ctts bias
    expect(elst.getUint16(16)).toBe(1); // media_rate_integer
  });

  it("writes ctts but no edit list when composition never leads decode (bias 0)", () => {
    // Synthetic: monotonic presentation running a constant frame AHEAD of
    // the decode cadence — offsets are positive, so no bias and no edit,
    // but the offsets themselves still need a ctts.
    const header = buildMp4Header({
      width: 640,
      height: 360,
      fps: 30,
      avcC: Uint8Array.from([1]),
      samples: [
        { size: 10, keyframe: true, timestampUs: 0 },
        { size: 10, keyframe: false, timestampUs: gridUs(2) },
        { size: 10, keyframe: false, timestampUs: gridUs(3) },
      ],
    });

    const ctts = payloadView(header, findBox(header, [...STBL_PATH, "ctts"]));
    expect(ctts.getUint32(4)).toBe(2); // entry_count
    expect([ctts.getUint32(8), ctts.getUint32(12)]).toEqual([1, 0]);
    expect([ctts.getUint32(16), ctts.getUint32(20)]).toEqual([2, 3000]);
    expect(() => findBox(header, ["moov", "trak", "edts"])).toThrow(
      /box not found/,
    );
  });
});
