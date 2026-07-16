// Pure MP4 (ISO BMFF) container muxing for offline video export (fr-92t9).
//
// WebCodecs' VideoEncoder hands back H.264 EncodedVideoChunks with no
// container around them — playable video needs a moov box describing every
// sample plus an mdat box holding their bytes. Building that box tree by
// hand (rather than pulling in a muxing library) keeps the export path
// dependency-free, like this module's mp4-duration.ts / webm-duration.ts
// siblings. The one twist here is scale: a clip can be tens of thousands of
// samples, and holding every encoded frame's bytes in one JS buffer just to
// hand it to a muxer would balloon memory. So this module never sees a
// sample's BYTES at all — only its size and keyframe flag — and builds only
// the file's HEADER (ftyp + moov + the 8-byte mdat box header). The caller
// assembles the real file as
// `new Blob([header, ...chunkBlobs], { type: "video/mp4" })`, so the
// browser streams the per-chunk Blobs together instead of anything
// concatenating them in JS memory. moov is written before mdat (a
// "faststart" file), and the layout matches a conventional
// single-video-track, single-chunk file — one avc1 sample entry, one
// contiguous run of samples in one chunk. Box layout per ISO/IEC 14496-12.

/** One encoded H.264 sample (video frame) in decode order. */
export interface Mp4Sample {
  /** Encoded byte length of this sample. */
  size: number;
  /** True when this sample is an IDR sync sample (EncodedVideoChunk.type === "key"). */
  keyframe: boolean;
}

export interface Mp4HeaderSpec {
  /** Coded frame width/height in pixels (even numbers by the encoder's contract). */
  width: number;
  height: number;
  /** Constant frame rate the samples were generated at. */
  fps: number;
  /**
   * AVCDecoderConfigurationRecord bytes (VideoEncoder decoderConfig.description),
   * embedded verbatim as the avc1 sample entry's avcC box payload.
   */
  avcC: Uint8Array;
  /** Every sample in the file, in decode order. */
  samples: readonly Mp4Sample[];
}

/** Movie and media timescale used throughout the file: units per second. */
const TIMESCALE = 90000;

/** Per-sample duration in timescale units, constant across the file. */
function sampleDelta(fps: number): number {
  return Math.round(TIMESCALE / fps);
}

/** Total movie duration in timescale units. */
function totalDuration(spec: Mp4HeaderSpec): number {
  return spec.samples.length * sampleDelta(spec.fps);
}

// ---------------------------------------------------------------------------
// Byte primitives
// ---------------------------------------------------------------------------

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Wrap `payload` in a compact (u32 size) ISO BMFF box: size(4) + type(4) + payload. */
function box(type: string, payload: Uint8Array): Uint8Array {
  return concatBytes([u32(8 + payload.length), ascii(type), payload]);
}

/** The version(1) + flags(3) header shared by every "full box". */
function fullBoxHeader(version: number, flags: number): Uint8Array {
  return Uint8Array.from([
    version,
    (flags >>> 16) & 0xff,
    (flags >>> 8) & 0xff,
    flags & 0xff,
  ]);
}

/** The unrotated, unscaled unity transform mvhd and tkhd both carry. */
const IDENTITY_MATRIX = concatBytes(
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32),
);

// ---------------------------------------------------------------------------
// Boxes outside the stbl table family (no stco offset to track)
// ---------------------------------------------------------------------------

function buildFtyp(): Uint8Array {
  return box(
    "ftyp",
    concatBytes([
      ascii("isom"), // major_brand
      u32(512), // minor_version
      ascii("isom"),
      ascii("iso2"),
      ascii("avc1"),
      ascii("mp41"), // compatible_brands
    ]),
  );
}

function buildMvhd(spec: Mp4HeaderSpec): Uint8Array {
  return box(
    "mvhd",
    concatBytes([
      fullBoxHeader(0, 0),
      u32(0), // creation_time
      u32(0), // modification_time
      u32(TIMESCALE),
      u32(totalDuration(spec)),
      u32(0x00010000), // rate: 1.0
      u16(0x0100), // volume: 1.0
      new Uint8Array(10), // reserved
      IDENTITY_MATRIX,
      new Uint8Array(24), // pre_defined
      u32(2), // next_track_ID
    ]),
  );
}

function buildTkhd(spec: Mp4HeaderSpec): Uint8Array {
  return box(
    "tkhd",
    concatBytes([
      fullBoxHeader(0, 0x000003), // enabled + in movie
      u32(0), // creation_time
      u32(0), // modification_time
      u32(1), // track_ID
      u32(0), // reserved
      u32(totalDuration(spec)),
      new Uint8Array(8), // reserved
      u16(0), // layer
      u16(0), // alternate_group
      u16(0), // volume: 0 for a non-audio track
      u16(0), // reserved
      IDENTITY_MATRIX,
      u32(spec.width * 0x10000), // width, 16.16 fixed point
      u32(spec.height * 0x10000), // height, 16.16 fixed point
    ]),
  );
}

function buildMdhd(spec: Mp4HeaderSpec): Uint8Array {
  return box(
    "mdhd",
    concatBytes([
      fullBoxHeader(0, 0),
      u32(0), // creation_time
      u32(0), // modification_time
      u32(TIMESCALE),
      u32(totalDuration(spec)),
      u16(0x55c4), // language "und", packed
      u16(0), // pre_defined
    ]),
  );
}

function buildHdlr(): Uint8Array {
  return box(
    "hdlr",
    concatBytes([
      fullBoxHeader(0, 0),
      u32(0), // pre_defined
      ascii("vide"), // handler_type
      new Uint8Array(12), // reserved
      ascii("VideoHandler\0"), // name, NUL-terminated
    ]),
  );
}

function buildVmhd(): Uint8Array {
  return box(
    "vmhd",
    concatBytes([
      fullBoxHeader(0, 1),
      u16(0), // graphicsmode
      u16(0),
      u16(0),
      u16(0), // opcolor: r, g, b
    ]),
  );
}

function buildDinf(): Uint8Array {
  const url = box("url ", fullBoxHeader(0, 0x000001)); // self-contained: data lives in this file
  const dref = box("dref", concatBytes([fullBoxHeader(0, 0), u32(1), url]));
  return box("dinf", dref);
}

function buildAvc1(spec: Mp4HeaderSpec): Uint8Array {
  return box(
    "avc1",
    concatBytes([
      new Uint8Array(6), // reserved
      u16(1), // data_reference_index
      new Uint8Array(16), // pre_defined(2) + reserved(2) + pre_defined[3](12), all zero
      u16(spec.width),
      u16(spec.height),
      u32(0x00480000), // horizresolution: 72 dpi
      u32(0x00480000), // vertresolution: 72 dpi
      u32(0), // reserved
      u16(1), // frame_count
      new Uint8Array(32), // compressorname
      u16(0x0018), // depth
      u16(0xffff), // pre_defined
      box("avcC", spec.avcC),
    ]),
  );
}

function buildStsd(spec: Mp4HeaderSpec): Uint8Array {
  return box(
    "stsd",
    concatBytes([fullBoxHeader(0, 0), u32(1), buildAvc1(spec)]),
  );
}

function buildStts(spec: Mp4HeaderSpec): Uint8Array {
  const sampleCount = spec.samples.length;
  const entry =
    sampleCount > 0 ? [u32(sampleCount), u32(sampleDelta(spec.fps))] : [];
  return box(
    "stts",
    concatBytes([fullBoxHeader(0, 0), u32(entry.length > 0 ? 1 : 0), ...entry]),
  );
}

function buildStss(spec: Mp4HeaderSpec): Uint8Array {
  const indices = spec.samples
    .map((sample, index) => (sample.keyframe ? index + 1 : undefined))
    .filter((index): index is number => index !== undefined);
  return box(
    "stss",
    concatBytes([
      fullBoxHeader(0, 0),
      u32(indices.length),
      ...indices.map(u32),
    ]),
  );
}

function buildStsc(spec: Mp4HeaderSpec): Uint8Array {
  const sampleCount = spec.samples.length;
  const entry = sampleCount > 0 ? [u32(1), u32(sampleCount), u32(1)] : [];
  return box(
    "stsc",
    concatBytes([fullBoxHeader(0, 0), u32(entry.length > 0 ? 1 : 0), ...entry]),
  );
}

function buildStsz(spec: Mp4HeaderSpec): Uint8Array {
  return box(
    "stsz",
    concatBytes([
      fullBoxHeader(0, 0),
      u32(0), // sample_size: 0 means "sizes follow individually"
      u32(spec.samples.length),
      ...spec.samples.map((sample) => u32(sample.size)),
    ]),
  );
}

// ---------------------------------------------------------------------------
// The stbl → moov spine: each of these boxes contains (transitively) stco,
// whose one chunk_offset entry can't be filled in until the whole header's
// byte length is known — see buildMp4Header. Each builder here returns not
// just its bytes but where inside them that entry lives, so the value can be
// patched after the fact without re-walking the tree. This never affects any
// box's LENGTH: chunk_offset is a fixed-width u32 regardless of its value.
// ---------------------------------------------------------------------------

interface BoxWithStcoOffset {
  bytes: Uint8Array;
  /**
   * Byte offset, relative to the start of `bytes`, of stco's one
   * chunk_offset field. Undefined when there are no samples — stco then has
   * entry_count 0 and no field to patch.
   */
  stcoOffset: number | undefined;
}

function buildStco(spec: Mp4HeaderSpec): BoxWithStcoOffset {
  const sampleCount = spec.samples.length;
  if (sampleCount === 0) {
    return {
      bytes: box("stco", concatBytes([fullBoxHeader(0, 0), u32(0)])),
      stcoOffset: undefined,
    };
  }
  const bytes = box(
    "stco",
    concatBytes([
      fullBoxHeader(0, 0),
      u32(1), // entry_count
      u32(0), // chunk_offset — patched by buildMp4Header once known
    ]),
  );
  // box header(8) + full-box header(4) + entry_count(4).
  return { bytes, stcoOffset: 16 };
}

function buildStbl(spec: Mp4HeaderSpec): BoxWithStcoOffset {
  const stsd = buildStsd(spec);
  const stts = buildStts(spec);
  const stss = buildStss(spec);
  const stsc = buildStsc(spec);
  const stsz = buildStsz(spec);
  const stco = buildStco(spec);

  const bytes = box(
    "stbl",
    concatBytes([stsd, stts, stss, stsc, stsz, stco.bytes]),
  );
  const stcoOffset =
    stco.stcoOffset === undefined
      ? undefined
      : 8 +
        stsd.length +
        stts.length +
        stss.length +
        stsc.length +
        stsz.length +
        stco.stcoOffset;
  return { bytes, stcoOffset };
}

function buildMinf(spec: Mp4HeaderSpec): BoxWithStcoOffset {
  const vmhd = buildVmhd();
  const dinf = buildDinf();
  const stbl = buildStbl(spec);

  const bytes = box("minf", concatBytes([vmhd, dinf, stbl.bytes]));
  const stcoOffset =
    stbl.stcoOffset === undefined
      ? undefined
      : 8 + vmhd.length + dinf.length + stbl.stcoOffset;
  return { bytes, stcoOffset };
}

function buildMdia(spec: Mp4HeaderSpec): BoxWithStcoOffset {
  const mdhd = buildMdhd(spec);
  const hdlr = buildHdlr();
  const minf = buildMinf(spec);

  const bytes = box("mdia", concatBytes([mdhd, hdlr, minf.bytes]));
  const stcoOffset =
    minf.stcoOffset === undefined
      ? undefined
      : 8 + mdhd.length + hdlr.length + minf.stcoOffset;
  return { bytes, stcoOffset };
}

function buildTrak(spec: Mp4HeaderSpec): BoxWithStcoOffset {
  const tkhd = buildTkhd(spec);
  const mdia = buildMdia(spec);

  const bytes = box("trak", concatBytes([tkhd, mdia.bytes]));
  const stcoOffset =
    mdia.stcoOffset === undefined
      ? undefined
      : 8 + tkhd.length + mdia.stcoOffset;
  return { bytes, stcoOffset };
}

function buildMoov(spec: Mp4HeaderSpec): BoxWithStcoOffset {
  const mvhd = buildMvhd(spec);
  const trak = buildTrak(spec);

  const bytes = box("moov", concatBytes([mvhd, trak.bytes]));
  const stcoOffset =
    trak.stcoOffset === undefined
      ? undefined
      : 8 + mvhd.length + trak.stcoOffset;
  return { bytes, stcoOffset };
}

/**
 * mdat's 8-byte box header alone: the declared size covers a payload (every
 * sample's encoded bytes) that is never materialized here — the caller
 * appends it separately, per this module's contract.
 */
function buildMdatHeader(payloadSize: number): Uint8Array {
  return concatBytes([u32(8 + payloadSize), ascii("mdat")]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the MP4 file header: ftyp + moov + the 8-byte mdat box header.
 * The complete file is these bytes followed by every sample's encoded
 * bytes concatenated in order (the caller assembles
 * new Blob([header, ...chunkBlobs], { type: "video/mp4" })).
 * moov precedes mdat, so the result is faststart/streamable by construction.
 * Throws RangeError if the mdat payload would overflow a u32 box size.
 */
export function buildMp4Header(spec: Mp4HeaderSpec): Uint8Array<ArrayBuffer> {
  const mdatPayloadSize = spec.samples.reduce(
    (sum, sample) => sum + sample.size,
    0,
  );
  if (8 + mdatPayloadSize > 0xffffffff) {
    throw new RangeError(
      `mdat payload of ${mdatPayloadSize} bytes overflows a u32 box size`,
    );
  }

  const ftyp = buildFtyp();
  const moov = buildMoov(spec);
  const mdatHeader = buildMdatHeader(mdatPayloadSize);
  const header = concatBytes([ftyp, moov.bytes, mdatHeader]);

  if (moov.stcoOffset !== undefined) {
    // The one circularity in this layout: stco's chunk_offset VALUE depends
    // on the header's total length, but that length never depended on the
    // value itself (a fixed-width u32 regardless of magnitude) — so it's
    // safe to patch it in now that `header` (and therefore its length)
    // exists.
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    );
    view.setUint32(ftyp.length + moov.stcoOffset, header.length);
  }

  return header;
}
