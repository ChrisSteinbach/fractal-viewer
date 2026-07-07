// In-place duration patch for Chrome MediaRecorder's fragmented MP4 output.
//
// Chrome's muxer stores a clip's duration only implicitly, spread across the
// moof fragments: moov/mvhd.duration stays 0 and tkhd/mdhd keep stale
// first-fragment values. Players tolerate this (they sum the fragments), but
// social-media upload probes read the moov metadata and refuse the file —
// Bluesky's "failed to get video duration" (fr-ex2). A recording knows its
// wall-clock duration when it stops, so we write that into every duration
// field in place: no re-muxing, no dependencies. Box layout per
// ISO/IEC 14496-12; the fixed field offsets below were verified against a
// real Chrome recording during the fr-ex2 diagnosis.

interface Box {
  type: string;
  /** First byte after the box header (the version byte, for full boxes). */
  contentStart: number;
  /** One past the last byte of the box. */
  end: number;
}

/** Iterate the boxes laid out back-to-back in [start, end). */
function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let contentStart = offset + 8;
    if (size === 0) {
      // Box extends to the end of its enclosing space.
      size = end - offset;
    } else if (size === 1) {
      // 64-bit "largesize"; > 4 GiB can't happen in a capped recording, so
      // treat a set high word as corruption and stop.
      if (offset + 16 > end) return;
      if (view.getUint32(offset + 8) !== 0) return;
      size = view.getUint32(offset + 12);
      contentStart = offset + 16;
    }
    if (size < contentStart - offset || offset + size > end) return;
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    yield { type, contentStart, end: offset + size };
    offset += size;
  }
}

function findBox(
  view: DataView,
  start: number,
  end: number,
  type: string,
): Box | undefined {
  for (const box of boxes(view, start, end)) {
    if (box.type === type) return box;
  }
  return undefined;
}

/**
 * Read a full box's timescale. mvhd and mdhd share the same shape:
 * version(1) flags(3) ctime mtime timescale duration, where the times are
 * 4 bytes in version 0 and 8 bytes in version 1.
 */
function readTimescale(view: DataView, box: Box): number {
  const version = view.getUint8(box.contentStart);
  return view.getUint32(box.contentStart + (version === 1 ? 20 : 12));
}

/**
 * Write a duration field, handling the version-0 (u32) / version-1 (u64)
 * width difference. Offsets are relative to the version byte.
 */
function writeDuration(
  view: DataView,
  box: Box,
  fieldOffsetV0: number,
  fieldOffsetV1: number,
  units: number,
): void {
  if (view.getUint8(box.contentStart) === 1) {
    view.setUint32(box.contentStart + fieldOffsetV1, 0);
    view.setUint32(box.contentStart + fieldOffsetV1 + 4, units);
  } else {
    view.setUint32(box.contentStart + fieldOffsetV0, units);
  }
}

function toUnits(durationMs: number, timescale: number): number {
  return Math.min(Math.round((durationMs / 1000) * timescale), 0xffffffff);
}

/**
 * Write `durationMs` into the moov's mvhd, every trak's tkhd (movie
 * timescale) and mdhd (its own timescale), and mvex/mehd when present.
 * Mutates `bytes` in place. Returns true when the mvhd was patched; when the
 * structure isn't recognised it returns false without modifying anything.
 */
export function patchMp4Duration(
  bytes: Uint8Array,
  durationMs: number,
): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = findBox(view, 0, bytes.byteLength, "moov");
  if (moov === undefined) return false;
  const mvhd = findBox(view, moov.contentStart, moov.end, "mvhd");
  if (mvhd === undefined) return false;
  const movieTimescale = readTimescale(view, mvhd);
  if (movieTimescale === 0) return false;

  const movieUnits = toUnits(durationMs, movieTimescale);
  writeDuration(view, mvhd, 16, 24, movieUnits);

  for (const child of boxes(view, moov.contentStart, moov.end)) {
    if (child.type === "trak") {
      const tkhd = findBox(view, child.contentStart, child.end, "tkhd");
      if (tkhd !== undefined) {
        // tkhd: version(1) flags(3) ctime mtime track_ID(4) reserved(4)
        // duration — times are 4/8 bytes for version 0/1.
        writeDuration(view, tkhd, 20, 28, movieUnits);
      }
      const mdia = findBox(view, child.contentStart, child.end, "mdia");
      const mdhd =
        mdia === undefined
          ? undefined
          : findBox(view, mdia.contentStart, mdia.end, "mdhd");
      if (mdhd !== undefined) {
        const mediaTimescale = readTimescale(view, mdhd);
        if (mediaTimescale !== 0) {
          writeDuration(
            view,
            mdhd,
            16,
            24,
            toUnits(durationMs, mediaTimescale),
          );
        }
      }
    } else if (child.type === "mvex") {
      const mehd = findBox(view, child.contentStart, child.end, "mehd");
      if (mehd !== undefined) {
        // mehd: version(1) flags(3) fragment_duration (u32/u64 by version).
        writeDuration(view, mehd, 4, 4, movieUnits);
      }
    }
  }
  return true;
}
