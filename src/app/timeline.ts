import { mulberry32 } from "../fractal/rng";
import { sanitizedMode } from "./collection";
import type { SavedSceneMode } from "./collection";

/**
 * The timeline — an ordered, AUTHORED sequence of keyframe steps played back
 * as a chain of morphs, with deterministic video export (fr-8v41). Where
 * `drift.ts`'s ambient show wanders a collection at random, the timeline is
 * the directed counterpart: a user arranges specific scenes in a specific
 * order, with per-step morph/hold timing they control.
 *
 * Steps are stored as already-ENCODED strings, never decoded — the same
 * opaque-string stance `collection.ts` and `history.ts` take, and for the
 * same reason: this module doesn't need `persist.ts` (or Three.js, or the
 * DOM) to move a step around. Each step is a frozen, independent copy (its
 * own `encoded` + `thumbnail` + its own `morphMs`/`holdMs` — and, since
 * fr-v3au, the render mode it plays in), NOT a reference into
 * `collection.ts`'s library — deleting a collection entry, or editing the
 * live scene, can never reach in and break a saved timeline.
 *
 * Unlike `SceneCollection`, which evicts its oldest entry once a save pushes
 * past its cap, `add` here REFUSES once the timeline is at `TIMELINE_CAP`
 * and returns `null`: a collection is a grab-bag where losing the oldest
 * keeper is a minor annoyance, but an authored sequence is order-sensitive —
 * silently dropping step 1 out from under a 20-step timeline would corrupt
 * the very thing the user built. For the same reason `persist()` never
 * evict-and-retries the way `collection.ts`'s does on a write failure:
 * shortening the sequence to make a write fit would corrupt it exactly as
 * badly as a silent eviction would. A persist failure (e.g. quota) is
 * swallowed instead — the in-memory list stays correct for the session,
 * just not durable, and the next successful edit gets another chance to
 * save.
 *
 * `seed` is the timeline's own determinism root, persisted alongside the
 * steps. Playback derives each leg's morph seed from it via `legSeed` (one
 * per departure→arrival transition), so re-playing the same timeline —
 * including a deterministic video export render — reproduces the exact same
 * point-for-point morph every time. `clear()` re-rolls it: a cleared
 * timeline is a fresh authoring session and shouldn't echo the old one's
 * morphs if scenes happen to be re-added in the same order.
 */

/**
 * One keyframe in the timeline. `encoded` is a `persist.ts` `encodeScene`
 * wire string — opaque and immutable here, exactly like `collection.ts`'s
 * `SavedScene.encoded` (this module never decodes it). `thumbnail` is a
 * small image data URL (may be `""` if capture failed). `morphMs` is how
 * long the morph INTO this step takes (the leg from the previous step, or
 * from the live scene for the first step); `holdMs` is how long playback
 * dwells on this step, once arrived, before the next leg departs.
 */
export interface TimelineStep {
  id: string;
  encoded: string;
  thumbnail: string;
  morphMs: number;
  holdMs: number;
  /** Render mode this keyframe plays in (fr-v3au): the renderer that was
   * showing when it was captured; absent = the points explorer. Playback
   * enters this renderer on arrival and holds the schedule until the render
   * meets its iteration budget — mirroring `SavedScene.mode` (fr-75sq), and
   * like it stored on the STEP, never inside `encoded`, so the scene
   * document itself stays render-mode-less (fr-39y). */
  mode?: SavedSceneMode;
}

/**
 * What an import file hands to {@link TimelineStore.replaceAll} — a
 * {@link TimelineStep} minus its `id` (fr-h9rk). Ids are storage-internal,
 * minted per `TimelineStore` instance (see `counter` below); a file produced
 * by a different session or device carries ids that mean nothing here, so
 * import always mints fresh ones rather than trusting the file's — the same
 * stance `collection.ts`'s `ImportableScene` takes on its own backup file.
 */
export type ImportableTimelineStep = Omit<TimelineStep, "id">;

/** localStorage key the timeline is persisted under; distinct from
 * `collection.ts`'s and `persist.ts`'s own keys so the three never collide. */
export const TIMELINE_STORAGE_KEY = "fractal-viewer:timeline";

/** Cap on stored steps; `add` refuses (returns `null`) rather than evict
 * once the timeline is at this size — see the module doc for why. */
export const TIMELINE_CAP = 20;

/** A freshly added step's `morphMs`, before the user tunes it. */
export const DEFAULT_STEP_MORPH_MS = 4000;

/** A freshly added step's `holdMs`, before the user tunes it. */
export const DEFAULT_STEP_HOLD_MS = 2000;

/** Per-field ceiling for `morphMs`/`holdMs` — both are clamped to
 * `[0, MAX_STEP_MS]` wherever they're set (load, `setTiming`). */
export const MAX_STEP_MS = 30_000;

/** Injectable dependencies; all default to browser/runtime globals. */
export interface TimelineDeps {
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Clock for id minting; defaults to `Date.now`. Injected for tests. */
  now?: () => number;
  /** Fresh-seed roller, used at first load (no persisted/valid seed) and by
   * `clear()`. Defaults to a `Math.random`-based 32-bit-ish roll. Injected
   * for tests so a re-roll is observable/deterministic. */
  rollSeed?: () => number;
}

/**
 * Clamp a step timing value to `[0, MAX_STEP_MS]`. `NaN` has no ordering to
 * clamp by, so it floors to `0` rather than propagating; `±Infinity` clamp
 * to the nearest bound like any other out-of-range value. Shared by the
 * loader (a stored value that passed `isTimelineStep`'s type check may still
 * be out of range, or even non-finite via a raw JSON overflow literal like
 * `1e999`) and `setTiming` (whose caller has already filtered to finite
 * values, so the `NaN` branch is dead there, but cheap to keep uniform).
 */
function clampMs(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), MAX_STEP_MS);
}

/** Type-guards `v` down to a finite `number` — used for the persisted
 * `seed`, where anything else (missing, a string, `NaN`, `±Infinity`) rolls
 * a fresh one rather than trusting a corrupt determinism root. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate one untrusted parsed step: a non-null object with the right
 * field TYPES. Like `collection.ts`'s `isSavedScene`, this exists because
 * `localStorage` is just JSON text that a corrupt write, a manual edit, or a
 * future/older build could have shaped differently — entries are checked
 * individually and dropped rather than rejecting the whole load.
 * `morphMs`/`holdMs` only need to be numbers, not FINITE numbers: an
 * in-range check here would wrongly drop an otherwise-good step over a
 * garbage timing value, when clamping it (see `clampMs`, applied by the
 * caller once a step passes this check) is enough to make it safe to keep.
 * The optional `mode` is NOT checked here either, the same stance
 * `collection.ts`'s `isSavedScene` takes on its own `mode` field: a garbage
 * value shouldn't cost the whole step, so `loadTimeline` sanitizes it
 * separately via the shared `sanitizedMode` (fr-v3au) instead of this
 * function rejecting the step outright.
 */
function isTimelineStep(v: unknown): v is TimelineStep {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.encoded === "string" &&
    typeof o.thumbnail === "string" &&
    typeof o.morphMs === "number" &&
    typeof o.holdMs === "number"
  );
}

/**
 * Load `{ seed, steps }` from `storage`. Never throws: no storage, a missing
 * key, invalid JSON, or a non-object payload all yield an empty timeline
 * with a freshly rolled seed. A missing or non-finite `seed` also rolls
 * fresh even when the steps are otherwise valid — a corrupt seed shouldn't
 * cost the authored sequence, just its determinism root. `steps` that isn't
 * an array yields no steps; otherwise each entry is validated individually
 * (`isTimelineStep`) and dropped alone if malformed, survivors have their
 * timings clamped (`clampMs`) and are truncated to the first `TIMELINE_CAP`
 * — sliced AFTER filtering, so a dropped entry doesn't shift a later valid
 * one out of the window — since the list is stored in playback order.
 */
function loadTimeline(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  rollSeed: () => number,
): { seed: number; steps: TimelineStep[] } {
  if (!storage) return { seed: rollSeed(), steps: [] };
  try {
    const raw = storage.getItem(TIMELINE_STORAGE_KEY);
    if (raw === null) return { seed: rollSeed(), steps: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { seed: rollSeed(), steps: [] };
    }
    const o = parsed as Record<string, unknown>;
    const seed = isFiniteNumber(o.seed) ? o.seed : rollSeed();
    const stepsRaw: unknown = o.steps;
    const steps = Array.isArray(stepsRaw)
      ? stepsRaw
          .filter(isTimelineStep)
          .slice(0, TIMELINE_CAP)
          .map((s) => ({
            id: s.id,
            encoded: s.encoded,
            thumbnail: s.thumbnail,
            morphMs: clampMs(s.morphMs),
            holdMs: clampMs(s.holdMs),
            mode: sanitizedMode(s.mode),
          }))
      : [];
    return { seed, steps };
  } catch {
    return { seed: rollSeed(), steps: [] };
  }
}

/**
 * The timeline's persistent store, backed by localStorage under
 * `TIMELINE_STORAGE_KEY`. The intended shape of use: an authoring UI calling
 * `add`/`remove`/`move`/`setTiming` as the user builds and tunes a sequence,
 * a playback driver reading `all()` + `seed` (via `legSeed`) to run the
 * morph chain, and `clear()` to start over.
 */
export class TimelineStore {
  private readonly storage?: Pick<Storage, "getItem" | "setItem">;
  private readonly now: () => number;
  private readonly rollSeed: () => number;
  private steps: TimelineStep[];
  private seedValue: number;
  /** Disambiguates two adds in the same millisecond — see `add`'s id
   * generation. Scoped to this instance, not persisted. */
  private counter = 0;

  constructor(deps?: TimelineDeps) {
    this.storage = deps?.storage ?? safeLocalStorage();
    this.now = deps?.now ?? Date.now;
    this.rollSeed =
      deps?.rollSeed ?? (() => Math.floor(Math.random() * 0xffffffff));
    const loaded = loadTimeline(this.storage, this.rollSeed);
    this.steps = loaded.steps;
    this.seedValue = loaded.seed;
  }

  /** Defensive copy of the steps, in playback order (index 0 first). */
  all(): TimelineStep[] {
    return [...this.steps];
  }

  get size(): number {
    return this.steps.length;
  }

  /** The persisted determinism seed — see `legSeed`. */
  get seed(): number {
    return this.seedValue;
  }

  /**
   * Append a new step at the end of the timeline (playback order — unlike
   * `SceneCollection.add`'s newest-first unshift). No dedupe: re-adding a
   * scene already present is legitimate authoring (e.g. an A → B → A loop),
   * unlike a collection save where a repeat is a re-bump of the same
   * keeper. The new step gets `DEFAULT_STEP_MORPH_MS`/`DEFAULT_STEP_HOLD_MS`
   * timings and an id minted the same way `SceneCollection.add` does
   * (`${this.now()}-${this.counter++}`). `mode` (fr-v3au) is the renderer
   * the capture came from; omit for the points explorer (see
   * {@link SavedSceneMode}). Returns `null` without persisting once the
   * timeline is already at `TIMELINE_CAP` — see the module doc for why this
   * refuses instead of evicting. Persists on success.
   */
  add(
    encoded: string,
    thumbnail: string,
    mode?: SavedSceneMode,
  ): TimelineStep | null {
    if (this.steps.length >= TIMELINE_CAP) return null;
    const step: TimelineStep = {
      id: `${this.now()}-${this.counter++}`,
      encoded,
      thumbnail,
      mode,
      morphMs: DEFAULT_STEP_MORPH_MS,
      holdMs: DEFAULT_STEP_HOLD_MS,
    };
    this.steps.push(step);
    this.persist();
    return step;
  }

  /** Remove the step with this id (no-op if absent). Persists. */
  remove(id: string): void {
    this.steps = this.steps.filter((s) => s.id !== id);
    this.persist();
  }

  /**
   * Re-insert a previously removed step at the position it was removed
   * from — the undo side of {@link remove}, the same delete-toast pattern
   * as `SceneCollection.restore` (fr-ifts): the caller hands back the exact
   * `TimelineStep` `remove` took out, plus its old index, because once a
   * step is gone there is nothing left to re-derive either from — and a
   * removed step may be the only copy of its scene anywhere. Unlike the
   * collection there is no `createdAt` ordering to re-derive a slot from —
   * the timeline IS its order — so the index is remembered instead, clamped
   * into the current range (a timeline shrunk since the delete restores at
   * its tail). A no-op when a step with this id is already present (a
   * double-restore) or the timeline is back at `TIMELINE_CAP` (the freed
   * slot was refilled) — the same refuse-over-evict stance as {@link add}.
   * Persists on success.
   */
  restore(step: TimelineStep, at: number): void {
    if (this.steps.length >= TIMELINE_CAP) return;
    if (this.steps.some((s) => s.id === step.id)) return;
    const index = Math.max(0, Math.min(at, this.steps.length));
    this.steps.splice(index, 0, step);
    this.persist();
  }

  /**
   * Swap the step with this id with its neighbor `delta` places over (`-1`
   * toward the start, `1` toward the end) — the authoring UI's reorder
   * buttons. No-op, without persisting, when the id is unknown or the swap
   * would run off either end (moving the first step up, or the last step
   * down). Persists only when a swap actually happened.
   */
  move(id: string, delta: -1 | 1): void {
    const at = this.steps.findIndex((s) => s.id === id);
    if (at === -1) return;
    const to = at + delta;
    if (to < 0 || to >= this.steps.length) return;
    const [step] = this.steps.splice(at, 1);
    this.steps.splice(to, 0, step);
    this.persist();
  }

  /**
   * Update one step's morph/hold timing. Each field in `timing` is
   * independent and optional: an omitted field leaves the step's current
   * value alone, and a PROVIDED-but-non-finite value (e.g. `NaN` from a
   * momentarily-cleared number input) also leaves the current value alone
   * rather than zeroing it — only a provided finite value is clamped (see
   * `clampMs`) and stored. No-op, without persisting, on an unknown id;
   * otherwise persists once the step is found, even if neither field ended
   * up changing.
   */
  setTiming(id: string, timing: { morphMs?: number; holdMs?: number }): void {
    const step = this.steps.find((s) => s.id === id);
    if (!step) return;
    if (timing.morphMs !== undefined && Number.isFinite(timing.morphMs)) {
      step.morphMs = clampMs(timing.morphMs);
    }
    if (timing.holdMs !== undefined && Number.isFinite(timing.holdMs)) {
      step.holdMs = clampMs(timing.holdMs);
    }
    this.persist();
  }

  /**
   * Replace the ENTIRE timeline with `steps` and `seed` — the import file's
   * whole-timeline REPLACEMENT (fr-h9rk), not a merge. An authored sequence
   * isn't mergeable the way a collection backup is: `SceneCollection.
   * importScenes` interleaves a backup's entries into whatever library
   * already exists, but a timeline IS its order — there's no sensible way to
   * splice one imported sequence into another already-arranged one. So
   * import swaps the whole thing out instead, and the CALLER owns any undo
   * snapshot (e.g. capturing `all()`/`seed` beforehand) — this method
   * doesn't stage one itself.
   *
   * Each incoming step is minted a fresh id the same way `add` does
   * (`${this.now()}-${this.counter++}`) — imported steps carry none (a
   * timeline file omits `id`, the same storage-internal field the collection
   * file omits) — and its timings are clamped the same way the storage
   * loader clamps a loaded step's (`clampMs`): a hand-edited file can carry a
   * raw JSON overflow literal like `1e999`, which parses to `Infinity`.
   * Steps beyond `TIMELINE_CAP` are dropped by the same leading slice
   * `loadTimeline` applies.
   *
   * An omitted or non-finite `seed` rolls a fresh one via `rollSeed` —
   * `loadTimeline`'s exact stance on its own missing/corrupt seed: it
   * shouldn't cost the authored sequence, just its determinism root.
   * Persists.
   */
  replaceAll(steps: readonly ImportableTimelineStep[], seed?: number): void {
    this.steps = steps.slice(0, TIMELINE_CAP).map((s) => ({
      id: `${this.now()}-${this.counter++}`,
      encoded: s.encoded,
      thumbnail: s.thumbnail,
      mode: s.mode,
      morphMs: clampMs(s.morphMs),
      holdMs: clampMs(s.holdMs),
    }));
    this.seedValue = isFiniteNumber(seed) ? seed : this.rollSeed();
    this.persist();
  }

  /**
   * Empty the timeline and re-roll its `seed` — a cleared timeline is a
   * fresh deterministic universe, not a continuation of the old one's
   * morphs. Persists.
   */
  clear(): void {
    this.steps = [];
    this.seedValue = this.rollSeed();
    this.persist();
  }

  /**
   * Write `{ seed, steps }` to storage, swallowing any thrown error (e.g. a
   * full-quota `QuotaExceededError`) instead of evicting steps to make the
   * write fit — see the module doc for why. A failed write leaves the
   * in-memory list exactly as the edit left it; only durability is lost. A
   * no-op when no storage is available.
   */
  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        TIMELINE_STORAGE_KEY,
        JSON.stringify({ seed: this.seedValue, steps: this.steps }),
      );
    } catch {
      // Swallowed deliberately — see the doc comment above.
    }
  }
}

/**
 * Deterministic morph seed for playback leg `index` of a timeline whose
 * stored seed is `seed`. One `mulberry32` draw per leg, keyed off the
 * timeline's own seed AND the leg index (via `Math.imul`, which keeps the
 * mixing in 32-bit integer space the way the rest of the codebase's PRNG
 * code does — see `rng.ts`), so every playback run of the same timeline
 * hands each leg the same 32-bit morph seed. That per-run repeatability is
 * the deterministic half of fr-8v41's video export: re-rendering the same
 * timeline reproduces the exact same point-for-point morphs, frame for
 * frame.
 */
export function legSeed(seed: number, index: number): number {
  return (
    Math.floor(
      mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0)() *
        0x100000000,
    ) >>> 0
  );
}

/**
 * Total playback duration: the sum of every step's `morphMs` + `holdMs`.
 * Takes a `Pick` rather than full `TimelineStep`s so a caller sketching a
 * hypothetical timing edit (e.g. a live slider preview) doesn't need to
 * fabricate `id`/`encoded`/`thumbnail` just to total it up.
 */
export function timelineDurationMs(
  steps: readonly Pick<TimelineStep, "morphMs" | "holdMs">[],
): number {
  return steps.reduce((total, step) => total + step.morphMs + step.holdMs, 0);
}

/** localStorage access throws in some private-browsing / sandboxed contexts,
 * and there is no `window` at all outside a browser. Copied from
 * `collection.ts` rather than imported — it isn't exported there. */
function safeLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
