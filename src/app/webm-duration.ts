// In-place (or minimally-grown) duration patch for MediaRecorder's WebM
// (EBML/Matroska) output — the WebM counterpart to mp4-duration.ts's fr-ex2
// fix (fr-87q).
//
// Firefox's WebM muxer writes a Segment > Info > Duration element but leaves
// its float64 value at 0 — the EBML equivalent of Chrome's moov duration
// staying 0. Chromium's muxer goes further and omits Duration entirely.
// Either way, social-media upload probes that read container metadata (e.g.
// Bluesky's) see no usable duration and refuse the file with "failed to get
// video duration". A recording knows its wall-clock duration when it stops,
// so we write that in: overwrite the float in place when a Duration element
// already exists, or splice a new one into Info when it doesn't — no
// re-muxing, no dependencies. Splicing shifts every byte after the insertion
// point, so any SeekHead entry pointing past Info (and the Segment's own
// size, when it's declared rather than left open-ended) is rewritten in the
// same pass. EBML layout per the Matroska spec; the two shapes patched here
// were verified against real Firefox and Chromium captures during the
// fr-87q diagnosis.

// ---------------------------------------------------------------------------
// Element ids (numeric value, marker bit included)
// ---------------------------------------------------------------------------

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const SEEKHEAD_ID = 0x114d9b74;
const SEEK_ID = 0x4dbb;
const SEEK_POSITION_ID = 0x53ac;
const INFO_ID = 0x1549a966;
const TIMESTAMP_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
const CLUSTER_ID = 0x1f43b675;

/** A freshly-spliced Duration element: id(2) + size(1, value 8) + float64(8). */
const DURATION_ELEMENT_LENGTH = 11;

/** TimestampScale's default (nanoseconds per Duration unit) when absent. */
const DEFAULT_TIMESTAMP_SCALE = 1_000_000;

// ---------------------------------------------------------------------------
// VINT primitives
// ---------------------------------------------------------------------------

/**
 * Byte length of a VINT from its leading byte: the count of leading zero
 * bits (0-7) plus one for the marker bit itself. A leading byte of 0 has no
 * marker bit within 8 bytes and is invalid — returns 0.
 */
function vintLength(firstByte: number): number {
  if (firstByte === 0) return 0;
  let length = 1;
  let mask = 0x80;
  while ((firstByte & mask) === 0) {
    mask >>= 1;
    length++;
  }
  return length;
}

interface Vint {
  value: number;
  length: number;
}

/**
 * Read an Element ID VINT: same length rule as any VINT, but the marker bit
 * is kept as part of the value. Matroska ids are 1-4 bytes, so a leading
 * byte below 0x10 (implying a 5+ byte id) is treated as malformed.
 */
function readId(view: DataView, offset: number, end: number): Vint | undefined {
  if (offset >= end) return undefined;
  const length = vintLength(view.getUint8(offset));
  if (length === 0 || length > 4 || offset + length > end) return undefined;
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + view.getUint8(offset + i);
  }
  return { value, length };
}

interface SizeVint {
  /** Content length, or undefined when every value bit is 1 ("unknown"). */
  value: number | undefined;
  length: number;
}

/**
 * Read a size VINT: the marker bit is stripped from the first byte before
 * accumulating. Detects "unknown" size byte-wise — every byte (the masked
 * first byte included) must equal its all-ones pattern.
 */
function readSize(
  view: DataView,
  offset: number,
  end: number,
): SizeVint | undefined {
  if (offset >= end) return undefined;
  const first = view.getUint8(offset);
  const length = vintLength(first);
  if (length === 0 || offset + length > end) return undefined;
  const widthMask = 0xff >> length;
  let value = first & widthMask;
  let allOnes = value === widthMask;
  for (let i = 1; i < length; i++) {
    const byte = view.getUint8(offset + i);
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { value: allOnes ? undefined : value, length };
}

/** Largest content length an L-byte size VINT can hold (all-ones is reserved). */
function maxSizeVintValue(length: number): number {
  return Math.pow(2, 7 * length) - 2;
}

function fitsSizeVint(value: number, length: number): boolean {
  return value <= maxSizeVintValue(length);
}

/** Smallest VINT length (1-8) able to hold `value` as a known size. */
function minimalSizeVintLength(value: number): number {
  let length = 1;
  while (length < 8 && value > maxSizeVintValue(length)) length++;
  return length;
}

/** Write `value` as an L-byte size VINT (marker bit set on the first byte). */
function writeSizeVint(
  view: DataView,
  offset: number,
  value: number,
  length: number,
): void {
  let remaining = value;
  for (let i = length - 1; i >= 1; i--) {
    view.setUint8(offset + i, remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  view.setUint8(offset, remaining | (0x80 >> (length - 1)));
}

// ---------------------------------------------------------------------------
// Plain big-endian uints (TimestampScale, SeekPosition — no marker bit)
// ---------------------------------------------------------------------------

function readUint(view: DataView, offset: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + view.getUint8(offset + i);
  }
  return value;
}

function writeUint(
  view: DataView,
  offset: number,
  length: number,
  value: number,
): void {
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    view.setUint8(offset + i, remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
}

function maxUintValue(length: number): number {
  return Math.pow(2, 8 * length) - 1;
}

// ---------------------------------------------------------------------------
// Element walking
// ---------------------------------------------------------------------------

interface EbmlElement {
  /** Offset of the element's first id byte. */
  start: number;
  id: number;
  /** Offset of the element's size VINT (== start + id byte length). */
  sizeOffset: number;
  sizeLength: number;
  /** Declared content length — always known here; see `walkChildren`. */
  size: number;
  contentStart: number;
  contentEnd: number;
}

/**
 * Enumerate the immediate children of a master element spanning
 * [start, end). Stops silently — without yielding further and without
 * throwing — at the first child that can't be read or whose size is
 * unknown: both mean "nothing reliable past this point", not "corrupt
 * file", since every real capture ends its Segment with an unknown-size
 * Cluster.
 */
function* walkChildren(
  view: DataView,
  start: number,
  end: number,
): Generator<EbmlElement> {
  let offset = start;
  while (offset < end) {
    const id = readId(view, offset, end);
    if (id === undefined) return;
    const sizeOffset = offset + id.length;
    const size = readSize(view, sizeOffset, end);
    if (size === undefined || size.value === undefined) return;
    const contentStart = sizeOffset + size.length;
    const contentEnd = contentStart + size.value;
    if (contentEnd > end) return;
    yield {
      start: offset,
      id: id.value,
      sizeOffset,
      sizeLength: size.length,
      size: size.value,
      contentStart,
      contentEnd,
    };
    offset = contentEnd;
  }
}

interface SegmentScan {
  info: EbmlElement | undefined;
  seekHeads: EbmlElement[];
}

/**
 * Find the first Info element and every SeekHead among a Segment's direct
 * children, stopping at the first Cluster — media payload, nothing above it
 * matters here — exactly like the walk itself stops at an unknown size.
 */
function scanSegmentChildren(
  view: DataView,
  contentStart: number,
  contentEnd: number,
): SegmentScan {
  let info: EbmlElement | undefined;
  const seekHeads: EbmlElement[] = [];
  for (const child of walkChildren(view, contentStart, contentEnd)) {
    if (child.id === CLUSTER_ID) break;
    if (child.id === INFO_ID && info === undefined) info = child;
    if (child.id === SEEKHEAD_ID) seekHeads.push(child);
  }
  return { info, seekHeads };
}

interface InfoScan {
  timestampScale: number;
  duration: EbmlElement | undefined;
}

/**
 * Find Info's TimestampScale (defaulting when absent) and its first
 * Duration. Returns undefined only when TimestampScale is present but reads
 * 0 — a meaningless scale we refuse to divide by.
 */
function scanInfoChildren(
  view: DataView,
  contentStart: number,
  contentEnd: number,
): InfoScan | undefined {
  let timestampScale: number | undefined;
  let duration: EbmlElement | undefined;
  for (const child of walkChildren(view, contentStart, contentEnd)) {
    if (child.id === TIMESTAMP_SCALE_ID && timestampScale === undefined) {
      timestampScale = readUint(view, child.contentStart, child.size);
    }
    if (child.id === DURATION_ID && duration === undefined) {
      duration = child;
    }
  }
  if (timestampScale === 0) return undefined;
  return {
    timestampScale: timestampScale ?? DEFAULT_TIMESTAMP_SCALE,
    duration,
  };
}

/** Write a fresh Duration element: id(0x4489) + size(1 byte, value 8) + float64. */
function writeDurationElement(
  view: DataView,
  offset: number,
  value: number,
): void {
  view.setUint8(offset, 0x44);
  view.setUint8(offset + 1, 0x89);
  view.setUint8(offset + 2, 0x88);
  view.setFloat64(offset + 3, value);
}

// ---------------------------------------------------------------------------
// Insert path — Info has no Duration to overwrite
// ---------------------------------------------------------------------------

interface SegmentSpan {
  sizeOffset: number;
  sizeLength: number;
  /** Declared content length, or undefined when the Segment's size is unknown. */
  size: number | undefined;
  contentStart: number;
}

/**
 * Build the patched output when Info has no Duration: splice an 11-byte
 * Duration element in as Info's first child, grow Info's (and, when known,
 * the Segment's) size VINT to match, and fix up every SeekPosition that
 * pointed past the insertion point. Returns undefined — touching nothing —
 * when a size VINT or SeekPosition field can't absorb the shift without
 * growing past its existing byte width.
 */
function insertDuration(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  info: EbmlElement,
  segment: SegmentSpan,
  seekHeads: readonly EbmlElement[],
  durationValue: number,
): Uint8Array<ArrayBuffer> | undefined {
  const oldInfoContentStart = info.contentStart;

  const newInfoSize = info.size + DURATION_ELEMENT_LENGTH;
  const newInfoVintLength = fitsSizeVint(newInfoSize, info.sizeLength)
    ? info.sizeLength
    : minimalSizeVintLength(newInfoSize);
  const delta = DURATION_ELEMENT_LENGTH + (newInfoVintLength - info.sizeLength);

  let newSegmentSize: number | undefined;
  if (segment.size !== undefined) {
    newSegmentSize = segment.size + delta;
    if (!fitsSizeVint(newSegmentSize, segment.sizeLength)) return undefined;
  }

  // Plan every SeekPosition rewrite before touching anything: a target at or
  // past the insertion point shifts by `delta`; a field whose own bytes live
  // at or past the insertion point is itself copied `delta` further along —
  // the two are independent (an early SeekHead commonly points forward).
  const seekWrites: { offset: number; length: number; value: number }[] = [];
  for (const seekHead of seekHeads) {
    for (const seek of walkChildren(
      view,
      seekHead.contentStart,
      seekHead.contentEnd,
    )) {
      if (seek.id !== SEEK_ID) continue;
      for (const field of walkChildren(
        view,
        seek.contentStart,
        seek.contentEnd,
      )) {
        if (field.id !== SEEK_POSITION_ID) continue;
        const value = readUint(view, field.contentStart, field.size);
        const target = segment.contentStart + value;
        const valueShifts = target >= oldInfoContentStart;
        const newValue = valueShifts ? value + delta : value;
        if (valueShifts && newValue > maxUintValue(field.size)) {
          return undefined;
        }
        const offsetShifts = field.contentStart >= oldInfoContentStart;
        seekWrites.push({
          offset: field.contentStart + (offsetShifts ? delta : 0),
          length: field.size,
          value: newValue,
        });
      }
    }
  }

  // Every check passed — the writes below are guaranteed to fit. Assemble
  // the output first (verbatim copies around the splice point), then apply
  // the fix-ups on top; `bytes` itself is never written to.
  const output = new Uint8Array(bytes.length + delta);
  output.set(bytes.subarray(0, info.sizeOffset), 0);
  output.set(
    bytes.subarray(oldInfoContentStart),
    info.sizeOffset + newInfoVintLength + DURATION_ELEMENT_LENGTH,
  );

  const outputView = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  writeSizeVint(outputView, info.sizeOffset, newInfoSize, newInfoVintLength);
  writeDurationElement(
    outputView,
    info.sizeOffset + newInfoVintLength,
    durationValue,
  );
  if (newSegmentSize !== undefined) {
    writeSizeVint(
      outputView,
      segment.sizeOffset,
      newSegmentSize,
      segment.sizeLength,
    );
  }
  for (const write of seekWrites) {
    writeUint(outputView, write.offset, write.length, write.value);
  }

  return output;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the patched bytes: the input array itself (mutated) when the
 * Duration could be overwritten in place, a new longer array when a Duration
 * element had to be inserted, or undefined when the structure was not
 * recognised — in which case the input is guaranteed byte-identical.
 */
export function patchWebmDuration(
  bytes: Uint8Array<ArrayBuffer>,
  durationMs: number,
): Uint8Array<ArrayBuffer> | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;

  // EBML header: must be present, correctly identified, and fully in bounds
  // (a declared size running past the buffer means a truncated capture).
  const ebmlId = readId(view, 0, length);
  if (ebmlId === undefined || ebmlId.value !== EBML_ID) return undefined;
  const ebmlSize = readSize(view, ebmlId.length, length);
  if (ebmlSize === undefined || ebmlSize.value === undefined) return undefined;
  const ebmlContentEnd = ebmlId.length + ebmlSize.length + ebmlSize.value;
  if (ebmlContentEnd > length) return undefined;

  // Segment: real captures leave its size unknown (streamed out with no
  // final byte count known up front), so a declared end is clamped to the
  // buffer rather than treated as truncation.
  const segmentId = readId(view, ebmlContentEnd, length);
  if (segmentId === undefined || segmentId.value !== SEGMENT_ID) {
    return undefined;
  }
  const segmentSizeOffset = ebmlContentEnd + segmentId.length;
  const segmentSize = readSize(view, segmentSizeOffset, length);
  if (segmentSize === undefined) return undefined;
  const segmentContentStart = segmentSizeOffset + segmentSize.length;
  const declaredSegmentEnd =
    segmentSize.value === undefined
      ? length
      : segmentContentStart + segmentSize.value;
  const segmentContentEnd = Math.min(declaredSegmentEnd, length);

  const { info, seekHeads } = scanSegmentChildren(
    view,
    segmentContentStart,
    segmentContentEnd,
  );
  if (info === undefined) return undefined;

  const infoScan = scanInfoChildren(view, info.contentStart, info.contentEnd);
  if (infoScan === undefined) return undefined;

  const durationValue = (durationMs * 1_000_000) / infoScan.timestampScale;

  const duration = infoScan.duration;
  if (duration !== undefined) {
    if (duration.size === 8) {
      view.setFloat64(duration.contentStart, durationValue);
      return bytes;
    }
    if (duration.size === 4) {
      view.setFloat32(duration.contentStart, durationValue);
      return bytes;
    }
    // Unexpected width — never risk producing a bogus float or a second
    // Duration alongside it.
    return undefined;
  }

  return insertDuration(
    bytes,
    view,
    info,
    {
      sizeOffset: segmentSizeOffset,
      sizeLength: segmentSize.length,
      size: segmentSize.value,
      contentStart: segmentContentStart,
    },
    seekHeads,
    durationValue,
  );
}
