import { patchWebmDuration } from "./webm-duration";

// ---------------------------------------------------------------------------
// EBML element ids (see webm-duration.ts's own constants)
// ---------------------------------------------------------------------------

const EBML_ID_BYTES = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT_ID_BYTES = [0x18, 0x53, 0x80, 0x67];
const SEEKHEAD_ID_BYTES = [0x11, 0x4d, 0x9b, 0x74];
const SEEK_ID_BYTES = [0x4d, 0xbb];
const SEEK_POSITION_ID_BYTES = [0x53, 0xac];
const INFO_ID_BYTES = [0x15, 0x49, 0xa9, 0x66];
const TIMESTAMP_SCALE_ID_BYTES = [0x2a, 0xd7, 0xb1];
const DURATION_ID_BYTES = [0x44, 0x89];
const CLUSTER_ID_BYTES = [0x1f, 0x43, 0xb6, 0x75];
// Not read by the patcher (it only cares about TimestampScale/Duration), but
// real Matroska ids, used to give the shape fixtures an authentic look.
const MUXING_APP_ID_BYTES = [0x4d, 0x80];
const WRITING_APP_ID_BYTES = [0x57, 0x41];
const TRACKS_ID_BYTES = [0x16, 0x54, 0xae, 0x6b];

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** A size VINT with the marker bit set, encoding `value` in `length` bytes. */
function vint(value: number, length: number): number[] {
  const bytes: number[] = new Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 1; i--) {
    bytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] = remaining | (0x80 >> (length - 1));
  return bytes;
}

/** The "unknown size" size VINT: every value bit set to 1. */
function vintUnknown(length: number): number[] {
  const bytes: number[] = new Array(length).fill(0xff);
  bytes[0] = (0x80 >> (length - 1)) | (0xff >> length);
  return bytes;
}

/** Smallest size-VINT length able to hold `value`, mirroring the patcher's own rule. */
function minimalLength(value: number): number {
  let length = 1;
  while (length < 8 && value > Math.pow(2, 7 * length) - 2) length++;
  return length;
}

/** An element's bytes: id + size VINT + payload. `sizeVintLength` defaults to minimal. */
function element(
  idBytes: number[],
  payload: number[],
  sizeVintLength?: number,
): number[] {
  const length = sizeVintLength ?? minimalLength(payload.length);
  return [...idBytes, ...vint(payload.length, length), ...payload];
}

/** A big-endian unsigned integer of `length` bytes. */
function uint(value: number, length: number): number[] {
  const bytes: number[] = new Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function f64(value: number): number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value);
  return Array.from(new Uint8Array(buffer));
}

function f32(value: number): number[] {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value);
  return Array.from(new Uint8Array(buffer));
}

function asciiBytes(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/** Minimal EBML header: id + size(0) — an empty header is valid and inert. */
function ebmlHeader(): number[] {
  return element(EBML_ID_BYTES, []);
}

/** An unknown-size Cluster followed by trailing junk, exactly like a live capture. */
function clusterUnknown(junk: number[]): number[] {
  return [...CLUSTER_ID_BYTES, ...vintUnknown(8), ...junk];
}

function seekPositionElement(value: number, byteLength: number): number[] {
  return element(SEEK_POSITION_ID_BYTES, uint(value, byteLength));
}

function seekElement(seekPosition: number[]): number[] {
  return element(SEEK_ID_BYTES, seekPosition);
}

function seekHeadElement(seeks: number[], sizeVintLength?: number): number[] {
  return element(SEEKHEAD_ID_BYTES, seeks, sizeVintLength);
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Byte offset immediately after the first occurrence of `needle` in `bytes`. */
function offsetAfter(bytes: Uint8Array, needle: number[]): number {
  for (let i = 0; i + needle.length <= bytes.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i + needle.length;
  }
  throw new Error("needle not found in fixture");
}

/** Decode a size VINT at `offset`, independently of the module under test. */
function readSizeVint(
  bytes: Uint8Array,
  offset: number,
): { value: number; length: number } {
  const first = bytes[offset];
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  let value = first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
  return { value, length };
}

/** Every SeekPosition value (assuming a fixed `byteLength`-byte width) found, in file order. */
function findSeekPositionValues(
  bytes: Uint8Array,
  byteLength: number,
): number[] {
  const values: number[] = [];
  for (let i = 0; i + 3 <= bytes.length; i++) {
    if (
      bytes[i] === SEEK_POSITION_ID_BYTES[0] &&
      bytes[i + 1] === SEEK_POSITION_ID_BYTES[1] &&
      bytes[i + 2] === (0x80 | byteLength)
    ) {
      let value = 0;
      for (let j = 0; j < byteLength; j++) {
        value = value * 256 + bytes[i + 3 + j];
      }
      values.push(value);
    }
  }
  return values;
}

describe("patchWebmDuration", () => {
  it("overwrites a Firefox-shaped capture's zero Duration in place", () => {
    // Firefox: unknown-size Segment, empty SeekHead, Info/Duration sizes all
    // as 8-byte VINTs, Duration present but stuck at 0.
    const info = element(
      INFO_ID_BYTES,
      [
        ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
        ...element(DURATION_ID_BYTES, f64(0)),
        ...element(MUXING_APP_ID_BYTES, asciiBytes("Lavf")),
        ...element(WRITING_APP_ID_BYTES, asciiBytes("Lavf")),
      ],
      8,
    );
    const seekHead = [...SEEKHEAD_ID_BYTES, ...vint(0, 8)];
    const tracks = element(
      TRACKS_ID_BYTES,
      Array.from({ length: 12 }, (_, i) => i),
      8,
    );
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...seekHead,
      ...info,
      ...tracks,
      ...clusterUnknown([0xaa, 0xbb, 0xcc, 0xdd]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);
    const durationContentStart = offsetAfter(bytes, [
      ...DURATION_ID_BYTES,
      0x88,
    ]);

    const result = patchWebmDuration(bytes, 19_962);

    expect(result).toBe(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getFloat64(durationContentStart)).toBe(19_962);
    expect(bytes.slice(0, durationContentStart)).toEqual(
      before.slice(0, durationContentStart),
    );
    expect(bytes.slice(durationContentStart + 8)).toEqual(
      before.slice(durationContentStart + 8),
    );
  });

  it("inserts a Duration into a Chromium-shaped capture that omits it", () => {
    // Chromium: unknown-size Segment, no SeekHead, Info size as a 1-byte
    // VINT (25), no Duration element at all.
    const infoContent = [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
      ...element(MUXING_APP_ID_BYTES, asciiBytes("Chrome")),
      ...element(WRITING_APP_ID_BYTES, asciiBytes("Chrome")),
    ];
    expect(infoContent.length).toBe(25);
    const info = element(INFO_ID_BYTES, infoContent, 1);
    const tracks = element(
      TRACKS_ID_BYTES,
      Array.from({ length: 10 }, (_, i) => i),
    );
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...info,
      ...tracks,
      ...clusterUnknown([0x11, 0x22, 0x33]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);
    const infoSizeOffset = offsetAfter(bytes, INFO_ID_BYTES);
    const oldInfoContentStart = infoSizeOffset + 1;

    const result = patchWebmDuration(bytes, 2_500);
    if (result === undefined) throw new Error("expected a patched array");

    expect(result).not.toBe(bytes);
    expect(result.length).toBe(bytes.length + 11);
    expect(bytes).toEqual(before);

    const { value: newInfoSize, length: newInfoVintLength } = readSizeVint(
      result,
      infoSizeOffset,
    );
    expect(newInfoSize).toBe(36);
    expect(newInfoVintLength).toBe(1);

    expect(
      result.slice(
        infoSizeOffset + newInfoVintLength,
        infoSizeOffset + newInfoVintLength + 11,
      ),
    ).toEqual(Uint8Array.from([0x44, 0x89, 0x88, ...f64(2_500)]));
    expect(result.slice(0, infoSizeOffset)).toEqual(
      before.slice(0, infoSizeOffset),
    );
    expect(result.slice(infoSizeOffset + newInfoVintLength + 11)).toEqual(
      before.slice(oldInfoContentStart),
    );
  });

  it("overwrites a 4-byte float32 Duration in place", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
      ...element(DURATION_ID_BYTES, f32(0)),
    ]);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...info,
      ...clusterUnknown([9]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const durationContentStart = offsetAfter(bytes, [
      ...DURATION_ID_BYTES,
      0x84,
    ]);

    const result = patchWebmDuration(bytes, 5_000);

    expect(result).toBe(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getFloat32(durationContentStart)).toBe(5_000);
  });

  it("scales the inserted Duration by a non-default TimestampScale", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(100_000, 3)),
    ]);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...info,
      ...clusterUnknown([1]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);

    const result = patchWebmDuration(bytes, 2_500);
    if (result === undefined) throw new Error("expected a patched array");

    const durationContentStart = offsetAfter(result, [
      ...DURATION_ID_BYTES,
      0x88,
    ]);
    const view = new DataView(
      result.buffer,
      result.byteOffset,
      result.byteLength,
    );
    expect(view.getFloat64(durationContentStart)).toBe(25_000);
  });

  it("defaults TimestampScale to 1,000,000 when absent", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(MUXING_APP_ID_BYTES, asciiBytes("x")),
    ]);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...info,
      ...clusterUnknown([1]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);

    const result = patchWebmDuration(bytes, 4_321);
    if (result === undefined) throw new Error("expected a patched array");

    const durationContentStart = offsetAfter(result, [
      ...DURATION_ID_BYTES,
      0x88,
    ]);
    const view = new DataView(
      result.buffer,
      result.byteOffset,
      result.byteLength,
    );
    expect(view.getFloat64(durationContentStart)).toBe(4_321);
  });

  it("grows Info's size VINT from 1 byte to 2 when the insert no longer fits", () => {
    const timestampScaleEl = element(
      TIMESTAMP_SCALE_ID_BYTES,
      uint(1_000_000, 3),
    );
    // Filler modeled on a Void element, sized so Info's content lands on
    // exactly 120 bytes: the most a 1-byte size VINT can hold room to grow
    // within (max 126), but 120 + 11 (the inserted Duration) overflows it.
    const voidEl = element(
      [0xec],
      Array.from({ length: 111 }, () => 0),
    );
    const infoContent = [...timestampScaleEl, ...voidEl];
    expect(infoContent.length).toBe(120);
    const info = element(INFO_ID_BYTES, infoContent, 1);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...info,
      ...clusterUnknown([7]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);
    const infoSizeOffset = offsetAfter(bytes, INFO_ID_BYTES);
    const oldInfoContentStart = infoSizeOffset + 1;

    const result = patchWebmDuration(bytes, 1_000);
    if (result === undefined) throw new Error("expected a patched array");

    expect(result.length).toBe(bytes.length + 12);
    const { value: newSize, length: newLength } = readSizeVint(
      result,
      infoSizeOffset,
    );
    expect(newSize).toBe(131);
    expect(newLength).toBe(2);
    expect(result.slice(infoSizeOffset, infoSizeOffset + 2)).toEqual(
      Uint8Array.from([0x40, 0x83]),
    );

    const newTailStart = infoSizeOffset + newLength + 11;
    expect(result.slice(newTailStart)).toEqual(
      before.slice(oldInfoContentStart),
    );
  });

  it("grows a known-size Segment's declared size in place when it still fits", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
    ]);
    const tracks = element(TRACKS_ID_BYTES, [1, 2, 3]);
    const segmentContent = [...info, ...tracks];
    const segment = element(SEGMENT_ID_BYTES, segmentContent, 2);
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);

    const result = patchWebmDuration(bytes, 750);
    if (result === undefined) throw new Error("expected a patched array");

    const delta = result.length - bytes.length;
    const segmentSizeOffset = offsetAfter(result, SEGMENT_ID_BYTES);
    const { value: newSegmentSize, length: segmentVintLength } = readSizeVint(
      result,
      segmentSizeOffset,
    );
    expect(segmentVintLength).toBe(2);
    expect(newSegmentSize).toBe(segmentContent.length + delta);
  });

  it("refuses to grow a known-size Segment past its size VINT's width", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
    ]);
    // 120 bytes total (12 Info + 108 filler) — a 1-byte VINT holds it, but
    // has no room left for the +11 delta the insert would need.
    const filler = element(
      [0xec],
      Array.from({ length: 106 }, () => 0),
    );
    const segmentContent = [...info, ...filler];
    const segment = element(SEGMENT_ID_BYTES, segmentContent, 1);
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);

    const result = patchWebmDuration(bytes, 1_000);

    expect(result).toBeUndefined();
    expect(bytes).toEqual(before);
  });

  it("fixes up SeekPositions that point past the insertion point, leaving earlier ones alone", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
    ]);
    const tracks = element(TRACKS_ID_BYTES, [1, 2, 3, 4]);

    const seekToSeekHead = seekElement(seekPositionElement(0, 2));
    // SeekHead (id 4 + size 1 + two same-shaped Seek entries) precedes Info,
    // so Tracks' offset relative to the Segment's content start is exactly
    // SeekHead's total length plus Info's — the two Seek entries have equal
    // length regardless of the SeekPosition values they carry.
    const seekHeadLength = 4 + 1 + seekToSeekHead.length * 2;
    const tracksOffset = seekHeadLength + info.length;
    const seekToTracks = seekElement(seekPositionElement(tracksOffset, 2));
    const seekHead = seekHeadElement([...seekToSeekHead, ...seekToTracks]);

    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...seekHead,
      ...info,
      ...tracks,
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);

    const result = patchWebmDuration(bytes, 1_000);
    if (result === undefined) throw new Error("expected a patched array");

    const delta = result.length - bytes.length;
    const positions = findSeekPositionValues(result, 2);
    expect(positions).toEqual([0, tracksOffset + delta]);
  });

  it("refuses a 1-byte SeekPosition that would overflow past 255", () => {
    const seek = seekElement(seekPositionElement(250, 1));
    const seekHead = seekHeadElement(seek);
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
    ]);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...seekHead,
      ...info,
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);

    const result = patchWebmDuration(bytes, 1_000);

    expect(result).toBeUndefined();
    expect(bytes).toEqual(before);
  });

  it("returns undefined for garbage input", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3]);

    expect(patchWebmDuration(bytes, 1_000)).toBeUndefined();
  });

  it("returns undefined when Info never appears before the first Cluster", () => {
    const tracks = element(TRACKS_ID_BYTES, [1, 2, 3]);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...tracks,
      ...clusterUnknown([0, 0]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);

    expect(patchWebmDuration(bytes, 1_000)).toBeUndefined();
    expect(bytes).toEqual(before);
  });

  it("returns undefined for a Duration with an unexpected size", () => {
    const info = element(INFO_ID_BYTES, [
      ...element(TIMESTAMP_SCALE_ID_BYTES, uint(1_000_000, 3)),
      ...element(DURATION_ID_BYTES, [0, 0]),
    ]);
    const segment = [
      ...SEGMENT_ID_BYTES,
      ...vintUnknown(8),
      ...info,
      ...clusterUnknown([1]),
    ];
    const bytes = Uint8Array.from([...ebmlHeader(), ...segment]);
    const before = Uint8Array.from(bytes);

    expect(patchWebmDuration(bytes, 1_000)).toBeUndefined();
    expect(bytes).toEqual(before);
  });

  it("returns undefined for a truncated file (EBML header size runs past the buffer)", () => {
    const bytes = Uint8Array.from([...EBML_ID_BYTES, ...vint(100, 1)]);

    expect(patchWebmDuration(bytes, 1_000)).toBeUndefined();
  });
});
