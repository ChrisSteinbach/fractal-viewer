/**
 * The JSON **file** codec for scene import/export — distinct from
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
 * make sense of never becomes an exception the caller has to guard against.
 * Version 1 preserves its original lenience (one bad collection/timeline entry
 * is dropped); asset-bearing version 2 is fail-closed as one bundle. Every
 * `encoded` string this module hands back has already
 * been round-tripped through `decodeScene` and found loadable — a returned
 * scene is genuinely understood by this build, not just shaped like one.
 * Version-2 source bytes have completed structural/reference checks here but
 * still require the async digest/worker barrier before they are renderable.
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
import { sanitizeSampledSolidStatus } from "./solid-render-status";
import {
  parsePortableMeshManifest,
  type ParsedPortableMeshManifest,
  type PortableMeshManifestWire,
} from "./portable-mesh-manifest";
import {
  assertSceneCustomMeshBudget,
  sceneCustomMeshIds,
} from "./scene-mesh-assets";
import type { CustomMeshAssetId } from "../fractal/mesh-shapes";

/**
 * Original asset-free format version. Asset-free export remains byte-compatible
 * with it; {@link decodeImportFile} also accepts the strict version 2 below.
 */
export const SCENE_FILE_VERSION = 1;

/** Asset-bearing files use a strict envelope whose source-only manifest is
 * validated as one unit before any imported document is published. */
export const PORTABLE_SCENE_FILE_VERSION = 2;

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
 * Ceiling on total sanitize ATTEMPTS (valid + invalid) per lenient version-1
 * import loop — 10× the loop's own entry cap. A real backup holds at most
 * that cap, so normal imports never reach this; it only bounds a hostile
 * file of tiny entries that each fail LATE in {@link sanitizeImportedScene}/
 * {@link sanitizeImportedStep} (a full {@link decodeScene} per entry), which
 * the valid-entry cap alone let run over the whole file. Once spent,
 * iteration stops and whatever valid entries were collected up to that point
 * are returned — the lenience contract, not a rejection.
 */
const MAX_IMPORT_SCENE_ATTEMPTS = 10 * COLLECTION_CAP;
const MAX_IMPORT_STEP_ATTEMPTS = 10 * TIMELINE_CAP;

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
  | {
      kind: "scene";
      encoded: string;
      assets?: ParsedPortableMeshManifest;
    }
  | {
      kind: "collection";
      scenes: ImportableScene[];
      assets?: ParsedPortableMeshManifest;
    }
  | {
      kind: "timeline";
      seed: number | undefined;
      steps: ImportableTimelineStep[];
      assets?: ParsedPortableMeshManifest;
    };

/**
 * Serialize one scene for an "Export scene" download. `encoded` is a
 * `persist.ts` `encodeScene` wire string, carried through verbatim (see this
 * module's doc comment on why). `exportedAt` is the caller's clock reading,
 * carried through as a courtesy timestamp only — nothing in this module
 * reads it back.
 */
export function encodeSceneFile(
  encoded: string,
  exportedAt: number,
  assets?: PortableMeshManifestWire,
): string {
  return JSON.stringify(
    {
      app: SCENE_FILE_APP,
      kind: "scene",
      version:
        assets === undefined ? SCENE_FILE_VERSION : PORTABLE_SCENE_FILE_VERSION,
      exportedAt,
      scene: encoded,
      assets,
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
  assets?: PortableMeshManifestWire,
): string {
  return JSON.stringify(
    {
      app: SCENE_FILE_APP,
      kind: "collection",
      version:
        assets === undefined ? SCENE_FILE_VERSION : PORTABLE_SCENE_FILE_VERSION,
      exportedAt,
      scenes: scenes.map((s) => ({
        encoded: s.encoded,
        createdAt: s.createdAt,
        mode: s.mode,
        solidStatus: s.solidStatus,
        thumbnail: s.thumbnail,
      })),
      assets,
    },
    null,
    2,
  );
}

/**
 * Serialize the authored timeline for a "⬇ Back up timeline" download.
 * Pass `TimelineStore.all()`'s result (playback order —
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
  assets?: PortableMeshManifestWire,
): string {
  return JSON.stringify(
    {
      app: SCENE_FILE_APP,
      kind: "timeline",
      version:
        assets === undefined ? SCENE_FILE_VERSION : PORTABLE_SCENE_FILE_VERSION,
      exportedAt,
      seed,
      steps: steps.map((s) => ({
        encoded: s.encoded,
        mode: s.mode,
        solidStatus: s.solidStatus,
        thumbnail: s.thumbnail,
        morphMs: s.morphMs,
        holdMs: s.holdMs,
      })),
      assets,
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
  return v === "flame" || v === "solid" || v === "surface" ? v : undefined;
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
  const { encoded, createdAt: rawCreatedAt, mode, solidStatus, thumbnail } = o;

  if (typeof encoded !== "string" || decodeScene(encoded) === null) {
    return null;
  }
  // Number.isFinite doesn't coerce (a numeric-looking string like "1" stays
  // rejected) but also doesn't narrow `unknown` the way a `typeof` check
  // does, so the cast below is only safe because this check already ran.
  if (!Number.isFinite(rawCreatedAt)) return null;
  const createdAt = rawCreatedAt as number;

  const sanitizedMode = sanitizedImportMode(mode);
  const sampledStatus =
    sanitizedMode === "solid"
      ? sanitizeSampledSolidStatus(solidStatus)
      : undefined;
  return {
    encoded,
    createdAt,
    mode: sanitizedMode,
    ...(sampledStatus ? { solidStatus: sampledStatus } : {}),
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
  const { encoded, morphMs, holdMs, mode, solidStatus, thumbnail } = o;

  if (typeof encoded !== "string" || decodeScene(encoded) === null) {
    return null;
  }
  if (typeof morphMs !== "number" || typeof holdMs !== "number") return null;

  const sanitizedMode = sanitizedImportMode(mode);
  const sampledStatus =
    sanitizedMode === "solid"
      ? sanitizeSampledSolidStatus(solidStatus)
      : undefined;
  return {
    encoded,
    morphMs,
    holdMs,
    mode: sanitizedMode,
    ...(sampledStatus ? { solidStatus: sampledStatus } : {}),
    thumbnail: sanitizedImportThumbnail(thumbnail),
  };
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function strictSceneReferences(encoded: string): CustomMeshAssetId[] | null {
  const snapshot = decodeScene(encoded);
  if (snapshot === null) return null;
  try {
    assertSceneCustomMeshBudget(snapshot);
  } catch {
    return null;
  }
  return sceneCustomMeshIds(snapshot);
}

/** Decode an asset-bearing version-2 envelope. Unlike the deliberately
 * lenient version-1 collection/timeline path, every entry must be valid and
 * every custom-mesh reference must match the manifest exactly. The returned
 * sources are structurally decoded but still require async digest and worker
 * validation before publication. */
function decodePortableImportFile(
  o: Record<string, unknown>,
): ImportedFile | null {
  const { kind, exportedAt, assets: rawAssets } = o;
  if (typeof exportedAt !== "number" || !Number.isFinite(exportedAt)) {
    return null;
  }
  if (kind === "scene") {
    if (
      !hasExactKeys(o, [
        "app",
        "assets",
        "exportedAt",
        "kind",
        "scene",
        "version",
      ]) ||
      typeof o.scene !== "string"
    ) {
      return null;
    }
    const references = strictSceneReferences(o.scene);
    if (references === null) return null;
    const assets = parsePortableMeshManifest(rawAssets, references);
    return assets === null ? null : { kind: "scene", encoded: o.scene, assets };
  }

  if (kind === "timeline") {
    if (
      !hasExactKeys(o, [
        "app",
        "assets",
        "exportedAt",
        "kind",
        "seed",
        "steps",
        "version",
      ]) ||
      !Array.isArray(o.steps) ||
      o.steps.length < 1 ||
      o.steps.length > TIMELINE_CAP
    ) {
      return null;
    }
    const steps: ImportableTimelineStep[] = [];
    const references: CustomMeshAssetId[] = [];
    for (const raw of o.steps) {
      if (
        typeof raw !== "object" ||
        raw === null ||
        Array.isArray(raw) ||
        !hasExactKeys(
          raw as Record<string, unknown>,
          ["encoded", "holdMs", "morphMs", "thumbnail"],
          ["mode", "solidStatus"],
        )
      ) {
        return null;
      }
      const step = sanitizeImportedStep(raw);
      if (step === null) return null;
      const ids = strictSceneReferences(step.encoded);
      if (ids === null) return null;
      steps.push(step);
      references.push(...ids);
    }
    const assets = parsePortableMeshManifest(rawAssets, references);
    if (assets === null) return null;
    return {
      kind: "timeline",
      seed:
        typeof o.seed === "number" && Number.isFinite(o.seed)
          ? o.seed
          : undefined,
      steps,
      assets,
    };
  }

  if (
    kind !== "collection" ||
    !hasExactKeys(o, [
      "app",
      "assets",
      "exportedAt",
      "kind",
      "scenes",
      "version",
    ]) ||
    !Array.isArray(o.scenes) ||
    o.scenes.length < 1 ||
    o.scenes.length > COLLECTION_CAP
  ) {
    return null;
  }
  const scenes: ImportableScene[] = [];
  const references: CustomMeshAssetId[] = [];
  for (const raw of o.scenes) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      !hasExactKeys(
        raw as Record<string, unknown>,
        ["createdAt", "encoded", "thumbnail"],
        ["mode", "solidStatus"],
      )
    ) {
      return null;
    }
    const scene = sanitizeImportedScene(raw);
    if (scene === null) return null;
    const ids = strictSceneReferences(scene.encoded);
    if (ids === null) return null;
    scenes.push(scene);
    references.push(...ids);
  }
  const assets = parsePortableMeshManifest(rawAssets, references);
  return assets === null ? null : { kind: "collection", scenes, assets };
}

/**
 * Parse and validate an import file's raw text, or `null` if it isn't one —
 * the never-throws trust boundary for untrusted file bytes (see this
 * module's doc comment). Requires `app === "fractal-viewer"`, one of the two
 * versions this module owns, and `kind` one of `"scene"` / `"collection"` /
 * `"timeline"`. Any other version rejects rather than being guessed at.
 *
 * For `kind: "scene"`, the `scene` field must be a string that
 * {@link decodeScene} itself accepts — a scene file whose one payload is
 * unusable has nothing to offer, so the whole file is rejected.
 *
 * In version 1, for `kind: "timeline"`, `steps` must be an array; entries are validated
 * INDIVIDUALLY by {@link sanitizeImportedStep}, dropping bad ones rather
 * than rejecting the file — the same lenience a `"collection"` file's
 * scenes get, below, and the same bounded-work caps, here
 * {@link TIMELINE_CAP} valid entries and {@link MAX_IMPORT_STEP_ATTEMPTS}
 * total sanitize attempts. A missing or non-finite `seed` becomes
 * `undefined` rather than rejecting the file — `TimelineStore.replaceAll`
 * rolls a fresh one when it sees that. The result may likewise carry an
 * empty `steps` array; reporting that is the caller's concern.
 *
 * In version 1, for `kind: "collection"`, `scenes` must be an array; entries are then
 * validated INDIVIDUALLY by {@link sanitizeImportedScene}, dropping bad ones
 * rather than rejecting the file — the same lenience `collection.ts`'s own
 * loader shows corrupt localStorage. Iteration stops once
 * {@link COLLECTION_CAP} valid entries have been collected or
 * {@link MAX_IMPORT_SCENE_ATTEMPTS} sanitize attempts have been spent, so a
 * hostile file with a million-entry array can't force unbounded work. The result may
 * be an empty array (every entry was invalid); reporting that is the
 * caller's concern. Version 2 instead requires every entry, the exact
 * reference union, and the source-only manifest to pass together; async digest
 * and topology validation deliberately follows in the import orchestrator.
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
    if (
      version !== SCENE_FILE_VERSION &&
      version !== PORTABLE_SCENE_FILE_VERSION
    ) {
      return null;
    }
    if (kind !== "scene" && kind !== "collection" && kind !== "timeline") {
      return null;
    }
    if (version === PORTABLE_SCENE_FILE_VERSION) {
      return decodePortableImportFile(o);
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
      let attempts = 0;
      for (const raw of rawSteps) {
        if (
          steps.length >= TIMELINE_CAP ||
          attempts >= MAX_IMPORT_STEP_ATTEMPTS
        ) {
          break;
        }
        attempts++;
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
    let attempts = 0;
    for (const raw of rawScenes) {
      if (
        scenes.length >= COLLECTION_CAP ||
        attempts >= MAX_IMPORT_SCENE_ATTEMPTS
      ) {
        break;
      }
      attempts++;
      const entry = sanitizeImportedScene(raw);
      if (entry !== null) scenes.push(entry);
    }
    return { kind: "collection", scenes };
  } catch {
    return null;
  }
}
