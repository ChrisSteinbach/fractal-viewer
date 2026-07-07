import { patchMp4Duration } from "./mp4-duration";

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u64(n: number): number[] {
  return [...u32(Math.floor(n / 0x100000000)), ...u32(n % 0x100000000)];
}

function fourCC(type: string): number[] {
  return [...type].map((char) => char.charCodeAt(0));
}

/** A box's bytes: size(4) + type(4) + payload, where size = payload.length + 8. */
function box(type: string, payload: number[]): number[] {
  return [...u32(payload.length + 8), ...fourCC(type), ...payload];
}

function verflags(version: number): number[] {
  return [version, 0, 0, 0];
}

/** mvhd/mdhd shape: verflags, ctime, mtime, timescale, duration (4/8 bytes by version). */
function timescaleBox(
  version: number,
  timescale: number,
  durationUnits: number,
): number[] {
  const time = version === 1 ? u64(0) : u32(0);
  const duration = version === 1 ? u64(durationUnits) : u32(durationUnits);
  return [
    ...verflags(version),
    ...time,
    ...time,
    ...u32(timescale),
    ...duration,
  ];
}

/** tkhd shape: verflags, ctime, mtime, track_ID, reserved, duration (4/8 bytes by version). */
function tkhdBox(
  version: number,
  trackId: number,
  durationUnits: number,
): number[] {
  const time = version === 1 ? u64(0) : u32(0);
  const duration = version === 1 ? u64(durationUnits) : u32(durationUnits);
  return [
    ...verflags(version),
    ...time,
    ...time,
    ...u32(trackId),
    ...u32(0),
    ...duration,
  ];
}

/** mehd shape: verflags, fragment_duration (4/8 bytes by version). */
function mehdBox(version: number, durationUnits: number): number[] {
  const duration = version === 1 ? u64(durationUnits) : u32(durationUnits);
  return [...verflags(version), ...duration];
}

/** Minimal ftyp box; its contents are inert filler ahead of moov. */
function ftypBox(): number[] {
  return box("ftyp", [...fourCC("isom"), ...u32(512), ...fourCC("isom")]);
}

/**
 * Byte offset of a box's first content byte (the version byte), found by
 * scanning for its 4-byte type tag rather than tracking offsets by hand.
 */
function findContentStart(bytes: Uint8Array, type: string): number {
  const tag = fourCC(type);
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (tag.every((byte, j) => bytes[i + j] === byte)) return i + 4;
  }
  throw new Error(`box "${type}" not found in fixture`);
}

describe("patchMp4Duration", () => {
  it("patches a Chrome-shaped v1 fragmented recording", () => {
    const mdhd = box("mdhd", timescaleBox(1, 30000, 1698));
    const mdia = box("mdia", mdhd);
    const tkhd = box("tkhd", tkhdBox(1, 1, 1698));
    const trak = box("trak", [...tkhd, ...mdia]);
    const mvhd = box("mvhd", timescaleBox(1, 1000, 0));
    const trex = box(
      "trex",
      Array.from({ length: 24 }, () => 0),
    );
    const mvex = box("mvex", trex);
    const moov = box("moov", [...mvhd, ...trak, ...mvex]);
    const bytes = Uint8Array.from([...ftypBox(), ...moov]);

    expect(patchMp4Duration(bytes, 20500)).toBe(true);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const mvhdStart = findContentStart(bytes, "mvhd");
    expect(view.getUint32(mvhdStart + 24)).toBe(0);
    expect(view.getUint32(mvhdStart + 28)).toBe(20500);

    const tkhdStart = findContentStart(bytes, "tkhd");
    expect(view.getUint32(tkhdStart + 28)).toBe(0);
    expect(view.getUint32(tkhdStart + 32)).toBe(20500);

    const mdhdStart = findContentStart(bytes, "mdhd");
    expect(view.getUint32(mdhdStart + 24)).toBe(0);
    expect(view.getUint32(mdhdStart + 28)).toBe(615000);
  });

  it("patches version-0 boxes with 32-bit durations", () => {
    const mdhd = box("mdhd", timescaleBox(0, 48000, 1698));
    const mdia = box("mdia", mdhd);
    const tkhd = box("tkhd", tkhdBox(0, 1, 1698));
    const trak = box("trak", [...tkhd, ...mdia]);
    const mvhd = box("mvhd", timescaleBox(0, 600, 0));
    const moov = box("moov", [...mvhd, ...trak]);
    const bytes = Uint8Array.from([...ftypBox(), ...moov]);

    expect(patchMp4Duration(bytes, 20500)).toBe(true);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(findContentStart(bytes, "mvhd") + 16)).toBe(12300);
    expect(view.getUint32(findContentStart(bytes, "tkhd") + 20)).toBe(12300);
    expect(view.getUint32(findContentStart(bytes, "mdhd") + 16)).toBe(984000);
  });

  it("patches mehd's fragment duration when present", () => {
    const mehd = box("mehd", mehdBox(0, 0));
    const mvex = box("mvex", mehd);
    const mvhd = box("mvhd", timescaleBox(1, 1000, 0));
    const moov = box("moov", [...mvhd, ...mvex]);
    const bytes = Uint8Array.from([...ftypBox(), ...moov]);

    expect(patchMp4Duration(bytes, 20500)).toBe(true);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(findContentStart(bytes, "mehd") + 4)).toBe(20500);
  });

  it("returns false and leaves bytes untouched when there is no moov", () => {
    const mdat = box("mdat", [1, 2, 3, 4]);
    const bytes = Uint8Array.from([...ftypBox(), ...mdat]);
    const before = Uint8Array.from(bytes);

    expect(patchMp4Duration(bytes, 20500)).toBe(false);
    expect(bytes).toEqual(before);
  });

  it("returns false and leaves bytes untouched when the moov has no mvhd", () => {
    const tkhd = box("tkhd", tkhdBox(0, 1, 0));
    const trak = box("trak", tkhd);
    const moov = box("moov", trak);
    const bytes = Uint8Array.from(moov);
    const before = Uint8Array.from(bytes);

    expect(patchMp4Duration(bytes, 20500)).toBe(false);
    expect(bytes).toEqual(before);
  });

  it("does not disturb bytes outside the duration fields", () => {
    const mdhd = box("mdhd", timescaleBox(1, 30000, 1698));
    const mdia = box("mdia", mdhd);
    const tkhd = box("tkhd", tkhdBox(1, 1, 1698));
    const trak = box("trak", [...tkhd, ...mdia]);
    const mvhd = box("mvhd", timescaleBox(1, 1000, 0));
    const trex = box(
      "trex",
      Array.from({ length: 24 }, () => 0),
    );
    const mvex = box("mvex", trex);
    const moov = box("moov", [...mvhd, ...trak, ...mvex]);
    const ftyp = ftypBox();
    const bytes = Uint8Array.from([...ftyp, ...moov]);

    const ftypBefore = bytes.slice(0, ftyp.length);
    const trexContentStart = findContentStart(bytes, "trex");
    const trexPayloadBefore = bytes.slice(
      trexContentStart,
      trexContentStart + 24,
    );

    patchMp4Duration(bytes, 20500);

    expect(bytes.slice(0, ftyp.length)).toEqual(ftypBefore);
    expect(bytes.slice(trexContentStart, trexContentStart + 24)).toEqual(
      trexPayloadBefore,
    );
  });

  it("clamps a duration that overflows 32 bits in a version-0 box", () => {
    const mvhd = box("mvhd", timescaleBox(0, 1000, 0));
    const moov = box("moov", mvhd);
    const bytes = Uint8Array.from(moov);

    expect(patchMp4Duration(bytes, 5_000_000_000)).toBe(true);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(findContentStart(bytes, "mvhd") + 16)).toBe(
      4_294_967_295,
    );
  });
});
