/**
 * The JSON **file** codec for scene import/export (fr-de9t) — distinct from
 * `persist.ts`'s `v1=<base64url>` wire format (which this module wraps, not
 * replaces) and from `collection.ts`'s localStorage persistence (which this
 * module only ever feeds via {@link ImportableScene}, never touches
 * directly — `collection.ts` deliberately does not import this module or
 * `persist.ts`, so scene decoding stays out of the storage layer).
 *
 * Three file kinds share one JSON envelope:
 *  - `"scene"` — a single encoded scene, for an "Export scene" / "Import
 *    scene" pair acting on the current document.
 *  - `"collection"` — a whole saved-scene library backup, for an "Export
 *    collection" / "Import collection" pair that merges back via
 *    `SceneCollection.importScenes`.
 *  - `"timeline"` — an authored animation timeline backup (ordered steps +
 *    the playback determinism seed), restored via `TimelineStore.replaceAll`
 *    (a whole-timeline REPLACEMENT, not a merge — see that method's doc
 *    comment).
 *
 * `decodeImportFile` is the trust boundary for untrusted file bytes — a file
 * picked from disk could be anything: hand-edited, from a future or older
 * build, or actively hostile — so, like `persist.ts`'s `decodeScene` and
 * `collection.ts`'s own storage loader, it NEVER throws. Anything it can't
 * make sense of becomes `null` (a "scene" file) or a dropped entry (one bad
 * scene inside a "collection" file), never an exception the caller has to
 * guard against. Every `encoded` string this module hands back has already
 * been round-tripped through `decodeScene` and found loadable — a returned
 * scene is genuinely renderable by this build, not just shaped like one.
 *
 * A deliberate choice: entries keep their ORIGINAL `encoded` string, never
 * re-encoded/canonicalized through `encodeScene`. A file written by a newer
 * build may carry fields this build's `SceneSnapshot` doesn't know about
 * yet; decoding and re-encoding would silently drop them. Round-tripping the
 * opaque string instead means a scene this build can only partially
 * understand still survives being imported here and re-exported later,
 * unmodified.
 */
import { decodeScene } from "./persist";
import { COLLECTION_CAP } from "./collection";
import type { ImportableScene, SavedScene, SavedSceneMode } from "./collection";
import { TIMELINE_CAP } from "./timeline";
import type { ImportableTimelineStep, TimelineStep } from "./timeline";

/**
 * Format version written into every exported file. {@link decodeImportFile}
 * requires an exact match — see its doc comment for why a mismatch always
 * rejects rather than trying to interpret an unrecognized version.
 */
export const SCENE_FILE_VERSION = 1;

/**
 * `app` marker naming the producer, written into every exported file.
 * {@link decodeImportFile} requires it, so a random JSON file that happens
 * to carry a `kind` field of its own is still cleanly rejected.
 */
const SCENE_FILE_APP = "fractal-viewer";

/**
 * Ceiling on one imported thumbnail's data-URL length, in characters.
 * {@link decodeImportFile} replaces an oversized (or non-`data:image/`)
 * thumbnail with `""` rather than dropping the entry — a thumbnail is
 * cosmetic, not worth losing a scene over — so a hostile file can't use it
 * to bloat localStorage once the entry lands in the collection. Real
 * captured thumbnails (see `scene.ts`'s `captureThumbnail`) run roughly
 * 10-20k characters.
 */
export const MAX_IMPORT_THUMBNAIL_CHARS = 256_000;

/**
 * Sanity ceiling on an import file's byte size, for the CALLER to check
 * before reading the file into memory — this module only ever sees already-
 * read `text`. A full {@link COLLECTION_CAP}-entry backup with every
 * thumbnail at {@link MAX_IMPORT_THUMBNAIL_CHARS} stays well under this.
 */
export const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;

/**
 * A parsed, validated import file — {@link decodeImportFile}'s success
 * shape. A `"collection"` file's `scenes` may be empty (every entry turned
 * out to be individually invalid); reporting that to the user is the
 * caller's concern, not this module's. A `"timeline"` file's `steps` may
 * likewise be empty; its `seed` is `undefined` when the file's is
 * missing/corrupt — costing the field, not the file, mirroring
 * `loadTimeline`'s own stance on a corrupt persisted seed — and
 * `TimelineStore.replaceAll` rolls a fresh one when it sees `undefined`.
 */
export type ImportedFile =
  | { kind: "scene"; encoded: string }
  | { kind: "collection"; scenes: ImportableScene[] }
  | {
      kind: "timeline";
      seed: number | undefined;
      steps: ImportableTimelineStep[];
    };

/**
 * Serialize one scene for an "Export scene" download. `encoded` is a
 * `persist.ts` `encodeScene` wire string, carried through verbatim (see this
 * module's doc comment on why). `exportedAt` is the caller's clock reading,
 * carried through as a courtesy timestamp only — nothing in this module
 * reads it back.
 */
export function encodeSceneFile(encoded: string, exportedAt: number): string {
  return JSON.stringify(
    {
      app: SCENE_FILE_APP,
      kind: "scene",
      version: SCENE_FILE_VERSION,
      exportedAt,
      scene: encoded,
    },
    null,
    2,
  );
}

/**
 * Serialize a whole collection for a "⬇ Back up collection" download.
 * Pass `SceneCollection.all()`'s result (newest-first); order is preserved
 * exactly as given, never re-sorted. `id` is DELIBERATELY omitted from every
 * entry — it is storage-internal, minted per `SceneCollection` instance (see
 * its `counter`), and meaningless once moved to another session or device;
 * {@link decodeImportFile} hands back {@link ImportableScene}s and
 * `SceneCollection.importScenes` mints fresh ids on merge. An entry with no
 * `mode` (the points explorer) naturally omits the key too, since
 * `JSON.stringify` drops `undefined`-valued properties.
 */
export function encodeCollectionFile(
  scenes: SavedScene[],
  exportedAt: number,
): string {
  return JSON.stringify(
    {
      app: SCENE_FILE_APP,
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt,
      scenes: scenes.map((s) => ({
        encoded: s.encoded,
        createdAt: s.createdAt,
        mode: s.mode,
        thumbnail: s.thumbnail,
      })),
    },
    null,
    2,
  );
}

/**
 * Serialize the authored timeline for a "⬇ Back up timeline" download
 * (fr-h9rk). Pass `TimelineStore.all()`'s result (playback order —
 * preserved exactly, never re-sorted). `seed` is the timeline's persisted
 * determinism root (see `timeline.ts`'s `legSeed`): carrying it means a
 * re-imported timeline replays — and video-exports — the exact same
 * point-for-point morphs, not merely the same scenes in the same order.
 * `id` is DELIBERATELY omitted from every step, for the same reason
 * {@link encodeCollectionFile} omits it — storage-internal, minted per
 * `TimelineStore` instance, and re-minted fresh on import (see
 * `TimelineStore.replaceAll`). A step with no `mode` (the points explorer)
 * naturally omits that key too, since `JSON.stringify` drops
 * `undefined`-valued properties.
 */
export function encodeTimelineFile(
  steps: TimelineStep[],
  seed: number,
  exportedAt: number,
): string {
  return JSON.stringify(
    {
      app: SCENE_FILE_APP,
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt,
      seed,
      steps: steps.map((s) => ({
        encoded: s.encoded,
        mode: s.mode,
        thumbnail: s.thumbnail,
        morphMs: s.morphMs,
        holdMs: s.holdMs,
      })),
    },
    null,
    2,
  );
}

/**
 * The entry's `mode` if it is a known {@link SavedSceneMode}, else
 * `undefined` — the same lenience `collection.ts`'s `sanitizedMode` shows a
 * garbage value loaded from storage: it costs the field, not the entry.
 */
function sanitizedImportMode(v: unknown): SavedSceneMode | undefined {
  return v === "flame" || v === "solid" ? v : undefined;
}

/**
 * The entry's `thumbnail` if it is a string, starts with `data:image/`, and
 * is no longer than {@link MAX_IMPORT_THUMBNAIL_CHARS} — else `""` (the
 * entry is kept regardless; a thumbnail is cosmetic, see that constant's
 * doc). The `data:image/` prefix requirement doubles as a safety net: it is
 * what guarantees an imported string can never smuggle a non-image URL into
 * the gallery's `img.src`.
 */
function sanitizedImportThumbnail(v: unknown): string {
  return typeof v === "string" &&
    v.startsWith("data:image/") &&
    v.length <= MAX_IMPORT_THUMBNAIL_CHARS
    ? v
    : "";
}

/**
 * Validate one untrusted parsed entry from a `"collection"` file's `scenes`
 * array into an {@link ImportableScene}, or `null` to drop it — the same
 * per-entry lenience `collection.ts`'s `isSavedScene` shows corrupt
 * localStorage (see its doc comment): one bad entry costs itself, not the
 * whole file. Unlike `isSavedScene`, `encoded` must additionally pass
 * {@link decodeScene} — the gate that keeps a scene nothing in this build
 * can actually load out of the gallery.
 */
function sanitizeImportedScene(v: unknown): ImportableScene | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { encoded, createdAt: rawCreatedAt, mode, thumbnail } = o;

  if (typeof encoded !== "string" || decodeScene(encoded) === null) {
    return null;
  }
  // Number.isFinite doesn't coerce (a numeric-looking string like "1" stays
  // rejected) but also doesn't narrow `unknown` the way a `typeof` check
  // does, so the cast below is only safe because this check already ran.
  if (!Number.isFinite(rawCreatedAt)) return null;
  const createdAt = rawCreatedAt as number;

  return {
    encoded,
    createdAt,
    mode: sanitizedImportMode(mode),
    thumbnail: sanitizedImportThumbnail(thumbnail),
  };
}

/**
 * Validate one untrusted parsed entry from a `"timeline"` file's `steps`
 * array into an {@link ImportableTimelineStep}, or `null` to drop it — the
 * timeline-file sibling of {@link sanitizeImportedScene}: the same per-entry
 * lenience (one bad step costs itself, not the whole file) and the same
 * {@link decodeScene} gate keeping a step nothing in this build can actually
 * load out of the file. `morphMs`/`holdMs` only need to be NUMBERS, not
 * FINITE ones — the exact stance `timeline.ts`'s `isTimelineStep` takes on
 * its own persisted steps (see its doc comment): an out-of-range value, or
 * even a non-finite one from a raw JSON overflow literal like `1e999`, is
 * clamped by `TimelineStore.replaceAll`, not worth dropping an otherwise-good
 * step over. `mode`/`thumbnail` reuse the same collection sanitizers
 * `sanitizeImportedScene` does — cost the field, never the step.
 */
function sanitizeImportedStep(v: unknown): ImportableTimelineStep | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { encoded, morphMs, holdMs, mode, thumbnail } = o;

  if (typeof encoded !== "string" || decodeScene(encoded) === null) {
    return null;
  }
  if (typeof morphMs !== "number" || typeof holdMs !== "number") return null;

  return {
    encoded,
    morphMs,
    holdMs,
    mode: sanitizedImportMode(mode),
    thumbnail: sanitizedImportThumbnail(thumbnail),
  };
}

/**
 * Parse and validate an import file's raw text, or `null` if it isn't one —
 * the never-throws trust boundary for untrusted file bytes (see this
 * module's doc comment). Requires the exact envelope this module writes:
 * `app === "fractal-viewer"`, `version === {@link SCENE_FILE_VERSION}`
 * (strict — a future breaking format change bumps the version and is
 * rejected rather than misread; an additive change wouldn't bump it and
 * decodes here unchanged), and `kind` one of `"scene"` / `"collection"` /
 * `"timeline"`.
 *
 * For `kind: "scene"`, the `scene` field must be a string that
 * {@link decodeScene} itself accepts — a scene file whose one payload is
 * unusable has nothing to offer, so the whole file is rejected.
 *
 * For `kind: "timeline"`, `steps` must be an array; entries are validated
 * INDIVIDUALLY by {@link sanitizeImportedStep}, dropping bad ones rather
 * than rejecting the file — the same lenience a `"collection"` file's
 * scenes get, below, and the same bounded-work cap, here
 * {@link TIMELINE_CAP} valid entries. A missing or non-finite `seed` becomes
 * `undefined` rather than rejecting the file — `TimelineStore.replaceAll`
 * rolls a fresh one when it sees that. The result may likewise carry an
 * empty `steps` array; reporting that is the caller's concern.
 *
 * For `kind: "collection"`, `scenes` must be an array; entries are then
 * validated INDIVIDUALLY by {@link sanitizeImportedScene}, dropping bad ones
 * rather than rejecting the file — the same lenience `collection.ts`'s own
 * loader shows corrupt localStorage. Iteration stops once
 * {@link COLLECTION_CAP} valid entries have been collected, so a hostile
 * file with a million-entry array can't force unbounded work. The result may
 * be an empty array (every entry was invalid); reporting that is the
 * caller's concern.
 */
export function decodeImportFile(text: string): ImportedFile | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const o = parsed as Record<string, unknown>;
    const { app, version, kind } = o;

    if (app !== SCENE_FILE_APP) return null;
    if (version !== SCENE_FILE_VERSION) return null;
    if (kind !== "scene" && kind !== "collection" && kind !== "timeline") {
      return null;
    }

    if (kind === "scene") {
      const { scene } = o;
      if (typeof scene !== "string" || decodeScene(scene) === null) {
        return null;
      }
      return { kind: "scene", encoded: scene };
    }

    if (kind === "timeline") {
      const { steps: rawSteps, seed } = o;
      if (!Array.isArray(rawSteps)) return null;
      const steps: ImportableTimelineStep[] = [];
      for (const raw of rawSteps) {
        if (steps.length >= TIMELINE_CAP) break;
        const entry = sanitizeImportedStep(raw);
        if (entry !== null) steps.push(entry);
      }
      return {
        kind: "timeline",
        seed:
          typeof seed === "number" && Number.isFinite(seed) ? seed : undefined,
        steps,
      };
    }

    const { scenes: rawScenes } = o;
    if (!Array.isArray(rawScenes)) return null;

    const scenes: ImportableScene[] = [];
    for (const raw of rawScenes) {
      if (scenes.length >= COLLECTION_CAP) break;
      const entry = sanitizeImportedScene(raw);
      if (entry !== null) scenes.push(entry);
    }
    return { kind: "collection", scenes };
  } catch {
    return null;
  }
}
