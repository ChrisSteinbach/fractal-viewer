# `src/app/` — document, persistence and panel UI

App state, the scene document's persistence and libraries, timelines, import/export file formats, the control panel and its controls, and input handling.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `background.ts` — the scene backdrop: `BACKGROUND_MODES` vocabulary
  (dark/haze/auto/flame/custom, extensible for curated presets);
  `resolveBackground` is the ONE mode→(top, bottom) definition every
  renderer/capture/compute-spec path shares. `"auto"` is
  the palette-linked backdrop: `autoBackground` darkens two
  `buildPaletteLUT` samples into disjoint luminance bands
  (`AUTO_BACKGROUND_TUNING` pins the curve; legacy/no-gradient palettes
  keep dark), `state.ts`'s `activeScenePalette`/`resolveSceneBackground`
  pick the tracked palette per render mode (coarse on purpose), and
  main.ts's `trackAutoBackground` re-derives on palette edits and
  render-mode landings — persisted as the MODE alone, never baked colors.
  `"flame"` selects a transient, low-budget 2D echo generated from the
  current system; only that mode id persists, never its bitmap, seed, blur,
  or budget. `lerpBackground` + `BackgroundTween` are the gradient-only
  replace-load crossfade, a fourth motion beside the system morph/camera/4D rotor
  glides — the SHAPE below is deliberately not part of it (no meaningful
  midpoint between linear and radial; it pops to the target's at the
  leg's first push). Persists via `persist.ts`, whose decoder doubles as
  the legacy migration (absent field + aerial style → haze). Pure,
  tested. `BackgroundParams.shape` is ORTHOGONAL to the gradient modes —
  the gradient SHAPE (`fractal/background-shape.ts`'s vocabulary) their
  two stops paint through, absent means `"linear"` byte-identical
  to every document predating it. `scene.ts`'s Shape select
  (`setBackgroundShape`) and `pushBackground` read it the same way the
  Background select reads `mode`.
- `state.ts` — `AppState` + pure reducers (pure, tested). Xaos blocks are
  derived from mutual-1 chi connectivity; the isolated-block gesture writes
  structure, leak dials summarize uniform cross-weights, and the matrix is
  the fine editor rather than the construction path.
- `persist.ts` — encode/decode scene to `#v1=<base64url>` hash + localStorage.
  Strict never-throwing decoder. Document carries optional `CameraPose` and
  optional `FourDPose` (rotor pair + w-slice; malformed quietly drops to
  `undefined`). THE POSE NAMES THE HYPERPLANE: `sliceW` is the WORLD
  rotated-w plane, PREFERRED on decode over the normalized centre, which is
  a fraction of a cloud whose seed is random per generation. RESTORE MUST
  NOT REWRITE that centre: the document keeps the sender's fraction and
  only RENDERING derives the effective one, or a reload copies a DIFFERENT
  document and the link stops being a fixed point. Undo snapshots stay
  camera/pose-less. Optional fold,
  julian/curl, bipolar and PDJ params encode
  only when present/finite and decode without coercion; family resolvers own
  defaults/domain. A post encodes only when present and non-identity as the
  strict 12-number `[m0..m8,tx,ty,tz]` wire. Absence stays byte-identical.
- `viewer-prefs.ts` — per-browser preferences under their own
  `fractal-viewer:prefs` localStorage key, deliberately OUTSIDE the scene
  document: a pref belongs to the person at this browser, so it
  must never ride the `#v1=` hash a shared link carries. localStorage only,
  never the URL/hash/`history`. Never-throwing load with strict validation
  (`false` is a real choice and survives); writes go through
  `updateViewerPrefs` (merge over stored — a bare save of one field would
  drop the others). Two prefs: `autoMotion` — one visible Automatic motion
  checkbox and shared 3D auto-orbit / 4D auto-tumble choice, `undefined` =
  never chosen, so boot follows
  prefers-reduced-motion — and `surfacePreview` — the surface
  quick-preview tier on/off; `false` freezes the pane during motion and
  settles straight to full detail on park (both engines), the
  no-patience-guessing line applied to the preview tier,
  with the progress row's one-shot Skip button as the in-the-moment
  escape (both engines). Pure, tested.
- `history.ts` — session-only undo/redo stacks (pure, tested).
- `edit-session.ts` — burst-coalescing over `history.ts`: one undo checkpoint
  per slider drag + debounced save. All effects injected; pure, tested.
- `collection.ts` — persistent multi-slot scene library (localStorage).
  `after(id)` is the drift slideshow's loop cursor. Entries carry optional
  `SavedSceneMode` (on the ENTRY, never inside `encoded`). `importScenes`
  merges backups with dedup + fresh ids. `setThumbnail(id, …)` (and its
  `timeline.ts` twin) replaces ONLY the picture — not `add`,
  which would mint a fresh id and re-bump the entry to the front: a
  correction is not a new save, and the gallery must not reshuffle under
  a user who is only waiting for a render. Pure, tested.
- `timeline.ts` — animation timeline document: ordered keyframe steps (frozen
  encoded scene + thumbnail + `morphMs`/`holdMs` + optional render mode).
  20-step cap (refuses, never evicts). `legSeed(seed, i)` for deterministic
  playback. Not references into the collection. Pure, tested.
- `timeline-player.ts` — timeline playback clock: ABSOLUTE schedule against
  start, catch-up fires only LATEST due leg. `hold()`/`resume()` suspend for
  render keyframes (content-dependent realtime clip length). main.ts's
  `launchTimelineLeg` wires the morph + camera pose glide + 4D rotor/slice
  glide per leg. A second `DriftPolicy` conducts it. Export = same run with
  recorder rolling, or the offline path. Pure, tested.
- `scene-file.ts` — JSON import/export: single-scene + collection backup +
  timeline backup sharing `{app, kind, version}` envelope. `decodeImportFile`
  is the never-throwing trust boundary (entries keep ORIGINAL encoded
  strings). Pure, tested.
- `flame-file.ts` — flam3/Apophysis `.flame` XML codec (see
  `docs/flame-interop.md`). Import QR-decomposes 2D coefs onto our
  `Transform`, folds pure-linear blends/posts, degrades unsupported features
  to warnings; palette becomes a full-resolution `RampPalette` (preserved
  whole — see `docs/flame-interop.md`). Export writes XY
  shadow with kaleidoscope baked into explicit xforms. Xaos rows parse and
  export in raw xform order, reindex around dropped maps, and omit at unity.
  Bipolar/PDJ fields round-trip as `bipolar_shift` and `pdj_a..d`; rings has
  no parameter attribute and reads imported/exported `coefs` translation.
  DOMParser-tied (jsdom tests). Pure, tested.
- `ui.ts` — control panel + transform list (`createElement`). Accordion of
  `<details name="panel-section">` sections, remembers open section per
  render mode. Mode content above the accordion (undo row, render progress).
  A FOLD variation's weight row carries the lengths that fold actually
  reads nested under it (box limit for a box fold, the sphere pair for a
  sphere fold, all three for a mandelbox — a box fold's `mR`/`fR`
  measured inert). Two rules keep `types.ts`'s "absent means classic
  BYTE-IDENTICALLY" true through an editing session:
  a length is written only once its own slider moves, and
  dragging one back to its classic value REMOVES it. The min-radius
  slider's ceiling IS the fixed radius and moves with it — the fold's
  domain `0 < mR <= fR` enforced in the row, so the readout is never a
  length `resolveFoldRadii` would silently clamp.
  A transform's FINISH group carries the same two rules one level up
  (to within half a slider step — a value round-trips through the
  slider's string and persist's rounding), plus a bundle select that is
  UI VOCABULARY ONLY: it SETS the sliders through that same per-field
  write, so Classic clears a finish outright and no bundle stores a
  classic-valued field (detection reads RESOLVED values, so
  `{specular: 0}` alone reads "Matte"). The forward-orbit disclosure
  reads the DOCUMENT's routing kind (`deriveSurfaceEligibility`'s
  `kind`) — NOT the session kind, unobservable here because the editor
  hides for the whole of a surface session. AND METALS READ AS THEIR
  SURROUNDINGS — nearly BLACK against the dark stops, since metalness
  damps the diffuse away
  and the backdrop is the only reflection source. Physically right, a
  mirror in an unlit room, so the hint and `docs/controls.md` DISCLOSE it
  rather than the BRDF fudging it.
- `control-spec.ts` — declarative spec for panel scalar controls. Adding a
  setting = one spec entry + one index.html row (pure, tested).
- `range-number-control.ts` — the exact-value companion every panel
  slider is paired with. `enhanceRangeWithNumber` MOVES the live range
  rather than cloning it, and never observes `range.disabled`:
  availability moves through `setDisabled`, so `slider-scroll-guard.ts`'s
  one-frame flip cannot leak onto the field. PRECISION IS THE DOMAIN, not
  the step — `step` is only the Arrow increment, and direct entry may be
  off-step but never off-precision. EVERY ARROW STEP GOES THROUGH
  `quantize`, base AND result, because stepping commits without
  re-validating: otherwise a REFUSED draft steps into a value the control
  rejects typed and is then displayed rounded, panel and document
  disagreeing.
- `legend-spec.ts` — the color legend as DATA: `deriveLegend`
  returns a plain `LegendSpec` (hidden / gradient bar + three labels /
  swatch strip of labels and color chips) and `ui.ts`'s `paintLegend` only
  paints it. Every family choice — the showcase override, the render-mode
  branches ahead of the document's 4D-ness, the palette-driven renders,
  the colorMode key — lives here, so it is tested without jsdom the way
  `control-spec.ts` is. The one thing it cannot derive is a palette's
  DISPLAY name (index.html's `<option>` labels are the app's single source
  of those), so the caller injects a `paletteName` lookup keyed by which
  `<select>` picked it.
- `describe.ts` + `shorten-url.ts` — the scene description as PROSE:
  `describeScene` composes a post-sized description to copy, edit and
  post; its optional scene link shortens via da.gd (`shorten-url.ts`,
  never-throw, any failure keeps the full link). The module doc owns the
  prose policies and mode dormancy; the subject precedence copies
  `scene-dimension.ts`'s and the family comes from the SAME analyzers
  the renderers route through.
- `constants.ts` — shared UI/interaction magic numbers.
- `interactions.ts` — pointer/touch/wheel handling (Three.js raycasting).
  Flame's frozen gate is action-specific: it refuses ordinary camera and
  transform motion but admits a Shift-started, release-latched 4D rotor drag,
  Shift-wheel, rotor/slice keys, and the visible Automatic motion preference.
  Pointer rotor edits commit once on release; wheel/keyboard view bursts
  commit once after 150 ms of quiet.
- `slider-scroll-guard.ts` — PREVENTS the panel sliders' tap-jump on
  touch, where an earlier pass repaired it after the fact (tested). The
  jump is the TOUCHSTART default action, not pointerdown's, so the one
  suppression that kills it AND keeps the pan is flipping `disabled` for
  that single handler — on in the pointerdown listener, off in a
  `requestAnimationFrame` callback, before paint, so the disabled look
  never reaches the screen. That kills the native drag too, so the guard
  DRIVES it: past `SLIDE_SLOP_PX` of horizontal travel it maps x onto the
  track, quantizes to the slider's own `step`, and fires `input` per
  change plus the trailing `change` the commit-on-release sliders hang
  off (`numPointsSlider` defers its whole regeneration to it, and a
  programmatic `value` assignment fires nothing). TAP-TO-SET IS GONE ON
  TOUCH by design — on a panel of full-width sliders a tap that lands on
  one is a scroll that has not moved yet far more often than it is an
  edit — and desktop click-to-jump is untouched. The four measured
  suppressions, the repair's doubled `input`, and the refuted
  "`preventDefault()` on pointerdown" claim are in the module's own
  header; verified on real Chromium via
  `scripts/panel-touch-scroll.verify.mjs`. Not verified on WebKit or
  Firefox Android.
