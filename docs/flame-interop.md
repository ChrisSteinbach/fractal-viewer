# `.flame` interop

How Fractal Explorer's scene vocabulary maps onto the flam3/Apophysis `.flame` XML
format, and exactly where the mapping is lossy. Implemented by
`src/app/flame-file.ts` (`decodeFlameFile` / `encodeFlameFile`), reachable
through the same panel buttons and drag-drop as the JSON scene files.

## Why the mapping is mostly exact

Four facts line the two vocabularies up better than they first appear:

1. **The affine group matches.** A flame xform's `coefs="a b c d e f"` is an
   arbitrary 2D affine map (`x' = a·x + c·y + e`, `y' = b·x + d·y + f` —
   column order, like an SVG matrix). Our `Transform` is
   `M = R·diag(scale)·U` — rotation, per-axis scale, and a unit
   upper-triangular shear — which parameterizes the _full_ affine group. So
   any coefs matrix imports exactly by QR decomposition:

   ```
   θ  = atan2(b, a)            rotation  [0, 0, θ]
   sx = |(a, b)|               scale     [sx, sy, 0]
   sy = det / sx
   k  = (a·c + b·d) / sx²      shear     [k, 0, 0]
   ```

   (Degenerate first column: θ comes from the second column instead, which
   spans those rank-deficient matrices exactly.) Round-trip error is only
   `persist.ts`'s 4-decimal rounding.

2. **The variations match by name — for twelve of them.** Our first twelve
   `VARIATION_TYPES` — linear, sinusoidal, spherical, swirl, horseshoe, polar,
   handkerchief, heart, disc, spiral, bubble, julia — are flam3's variation
   _attribute names_, with the same formulas at `z = 0` (`variations.ts` lifts
   the radial ones through the 3D radius, which equals the planar radius at
   `z = 0`, and carries `z` through the angular ones). `composeVariations` is
   flam3's own semantics: an unnormalized weighted sum that replaces the
   affine point. Imported maps pin `scale.z = 0` and every z field to 0, so
   the orbit lives in the `z = 0` plane and our 3D engine reproduces flam3's
   planar dynamics exactly. (The other five — `boxfold`, `spherefold`,
   `mandelbox`, `qsquare`, and `bulb` — are ours, not flam3's; see "A
   deliberate deviation" below.)

3. **The lens matches.** flam3's `<finalxform>` is applied at plot time and
   never fed back into the orbit — precisely our `finalTransform`.

4. **The per-xform color matches.** A flame xform's `color` is a
   palette _coordinate_, not an RGB triple: the slot the orbit's color
   coordinate is pulled toward whenever that map is picked, at the map's
   `color_speed` (`c ← c·(1 - speed) + color·speed`). That is exactly
   `Transform.colorIndex` / `Transform.colorSpeed` — same `[0, 1]` range, same
   blend, same "keyed on the base map, so every kaleidoscope copy colors as
   the map it copies" rule (`flame.ts`'s `accumulateFlame`). flam3's older
   spelling of the speed is the deprecated `symmetry` attribute:

   ```
   color_speed = (1 - symmetry) / 2        symmetry = 1 - 2·color_speed
   ```

   The conversion checks out on both landmarks: flam3's default `symmetry="0"`
   is speed `0.5` — `chaos-game.ts`'s `DEFAULT_COLOR_SPEED`, and the halfway
   blend every flame render hard-coded before the fields existed — and a
   flam3 "symmetry xform" (`symmetry="1"`, which shades without recoloring)
   is speed `0`, our pinned coordinate.

   Both attributes are optional in both directions: an imported xform that
   carries neither leaves the keys absent, so the derived even spread
   (`derivedColorIndex`) and `DEFAULT_COLOR_SPEED` apply and the file renders
   as it always did.

## A deliberate deviation: the fold family isn't flam3's

Fact 2 above has a carve-out. Twelve of our seventeen `VARIATION_TYPES` are
flam3's own attribute names; five are ours — the Mandelbox fold family,
`boxfold`/`spherefold`/`mandelbox`, and the two escape-time power
maps, `qsquare` and `bulb`. flam3 and Apophysis have
no plain variation attributes by any of these five names — the fold family's
Mandelbox-adjacent look lives in separately parameterized plugins with
different names and different formulas, not a drop-in match, and
`qsquare`/`bulb` have no flam3 analogue at all — so there was no existing
name being claimed or collided with when any of the five was added.

Two consequences follow, both accepted on purpose rather than discovered
after the fact:

- **Export.** A scene using one of the five writes a
  `boxfold`/`spherefold`/`mandelbox`/`qsquare`/`bulb` attribute no other
  flam3/Apophysis tool defines — the shape degrades there exactly as any
  unrecognized variation would. Our own importer round-trips it exactly,
  because it's reading its own name back.
- **Import.** A foreign `.flame` file that happens to carry an attribute
  literally named one of the five — essentially never from a genuine
  flam3/Apophysis export, conceivably from a hand-edited file or another
  tool's own extension — is read as our variation, not flagged as
  unsupported. It no longer contributes to the aggregated
  unknown-variations warning, because the name-matching import path can't
  tell it apart from a real one.
- **Custom radii.** A fold variation's `minRadius`/`fixedRadius`/
  `boxLimit` have no flam3 attribute to live in at all — the format has no
  per-variation parameter concept for a plain named variation, just a single
  weight. Export therefore always writes the bare `type="weight"` attribute,
  regardless of the document's lengths, and warns whenever they would render
  differently than what a `.flame` reader (ours re-importing included) sees:
  absent lengths, or lengths present but numerically equal to the classic
  Mandelbox values, export silently, since nothing about the shape changes;
  anything else warns, because the exported file always reads back at the
  classic lengths. Import has nothing to recover — there is nowhere in the
  XML the value could have come from, so a re-imported fold variation is
  always unparameterized. (`qsquare`/`bulb` carry no per-variation
  parameters of their own — this bullet is fold-only, unlike the two above.)

`VARIATION_NAMES` (the set `decodeFlameFile`/`encodeFlameFile` match against)
stays mechanically derived from `VARIATION_TYPES` — one array, not a
flam3-only subset — by design: special-casing the fold family out of
import/export would trade away our own round-trip fidelity for strict
flam3-name purity, and round-tripping our own exports exactly was judged the
more valuable property to protect.

## Import (`.flame` → scene)

| flame                                                | explorer                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `coefs`                                              | QR → position/rotation/scale/shear (exact)                                                                                                |
| pure `linear="w"` blend                              | folded into the affine (`w·A`, `w·t`), list omitted (exact)                                                                               |
| known variation attrs                                | `variations: [{type, weight}]` by name (exact)                                                                                            |
| `post` on a purely affine map                        | composed into the affine (exact)                                                                                                          |
| `post` on a nonlinear map                            | **dropped + warning** (nothing to hang it on)                                                                                             |
| unknown variations/parameters                        | **ignored + one aggregated warning** naming the attributes                                                                                |
| `weight`                                             | `Transform.weight`; all-equal weights omitted (uniform)                                                                                   |
| `weight ≤ 0` xform                                   | **skipped + warning**                                                                                                                     |
| `chaos` (xaos)                                       | `Transform.chaos` row: sanitized, pad/truncated to the base xform count, reindexed around any dropped xform — see "Xaos" below            |
| `opacity="0"`                                        | imported visible + warning (no per-map opacity)                                                                                           |
| `color`                                              | `Transform.colorIndex`, clamped to `[0, 1]`; absent ⇒ key omitted                                                                         |
| `color_speed`                                        | `Transform.colorSpeed`, clamped to `[0, 1]`; wins over `symmetry` when both appear                                                        |
| `symmetry` (deprecated)                              | `Transform.colorSpeed = (1 - symmetry) / 2`, clamped                                                                                      |
| `<finalxform>`                                       | `finalTransform` (same rules; its weight ignored)                                                                                         |
| palette (`<palette>` hex block or `<color>` entries) | preserved at full entry count as a `RampPalette` (`customPalette.kind = "ramp"`); `flame.paletteId` and `rampPaletteId` become `"custom"` |
| `brightness` / `gamma` / `vibrancy`                  | `flame.exposure` (`brightness / 4`) / `gamma` / `vibrancy`, clamped to our ranges                                                         |
| `supersample`/`oversample`, `estimator_*`            | the matching `FlameParams` fields, clamped                                                                                                |
| `size`/`center`/`scale`/`rotate`                     | ignored — the explorer auto-fits its own camera                                                                                           |

"Known variation attrs" matches any of our seventeen `VARIATION_TYPES` by name
— the fold family and the two power maps included, per the deviation above.
A genuine flam3/Apophysis file essentially never carries a
`boxfold`/`spherefold`/`mandelbox`/`qsquare`/`bulb` attribute, but one that
does gets read as our variation rather than flagged as an unsupported
feature.

Everything else about the imported scene (point count, render style, color
mode, …) takes the app's defaults. A file with several `<flame>` elements
imports every one (capped at the collection size); the UI loads a single
flame as the current scene and merges a multi-flame file into the collection.

### The palette is preserved whole

Both palette forms — the Apophysis `<palette count format="RGB">` hex block
and flam3's `<color index rgb="…"/>` entries — import as a full-resolution
`RampPalette` (`palette.ts`), NOT an 8-stop point sample. Earlier versions
downsampled every gradient onto the 8-stop `CustomPalette` the gradient
editor authors, which interpolated straight across exactly what makes these
gradients look the way they do: narrow bright bands, hard hue jumps and dark
gaps. The imported ramp rides the scene's usual Custom palette slots
(`snapshot.customPalette` + `paletteId`/`rampPaletteId` → `"custom"`) and
renders through the same 256-wide LUT every renderer already samples, so no
render path changes; entries past `MAX_RAMP_ENTRIES` (4096) truncate without
a warning (a palette is cosmetic), and fewer than two usable entries leaves
the default palette. On the wire the ramp encodes as one concatenated hex
string (see `persist.ts`'s `encodePaletteWire`), and the gradient editor
discloses the conversion: it displays 8 stops derived from the ramp, and the
first edit replaces the ramp with an authored 8-stop palette.

`decodeFlameFile` is a never-throwing trust boundary like `scene-file.ts`'s
`decodeImportFile`: unusable input returns `null` (not a flame file) or drops
individual flames with warnings, and every returned `encoded` string has
already passed `decodeScene` — a returned scene is genuinely loadable.

## Export (scene → `.flame`)

The export writes the system's **XY shadow**:

- Exact for z-flat systems — in particular, anything that was imported from a
  `.flame` round-trips exactly (up to 4-decimal rounding), the one exception
  being a final xform's color speed (see below).
- A genuinely 3D system (any map whose composed affine writes z: `m₂₀`,
  `m₂₁`, or `t_z` nonzero) or 4D system exports its projection with a
  warning. The 2D dynamics is the shadow of the 3D dynamics only when the
  attractor is confined to a z-plane, so expect a different (often still
  pleasing) figure in Apophysis.
- Kaleidoscope copies are baked into explicit xforms, the same way flam3's
  own symmetry macro materializes them: an affine map's copy composes the
  copy rotation straight into `coefs`; a nonlinear map keeps its base
  `coefs` and carries the rotation as `post` (our copy rotation applies to
  the variation _output_, which is exactly flam3's `post` slot). A z-axis
  kaleidoscope of a z-flat system therefore exports exactly; x/y-axis
  kaleidoscopes flatten with a warning.
- `chaos` rows export when the system carries any non-trivial one
  (`systemHasChaos`) — see "Xaos" below for the write gate, the
  kaleidoscope-copy expansion, and the final-transform exclusion.
- `finalTransform` → `<finalxform>`; variations pass through by name (merged
  by type — XML attributes must be unique); weights pass through as-is.
- Per-xform colors are written **resolved**: a map's authored
  `colorIndex`/`colorSpeed`, else the same fallbacks the render resolves
  through — `derivedColorIndex`'s even spread `i / (n - 1)` (`0.5` for a lone
  map) and `DEFAULT_COLOR_SPEED`. The file therefore states what we draw
  rather than what we store, and re-importing an export reproduces the same
  colors as explicit values. Each baked kaleidoscope copy carries its **base**
  map's color, matching the render's `idx % baseTransformCount` rule.
- The speed is written in **both** spellings — `color_speed="s"` and
  `symmetry="1 - 2·s"`, which is flam3's own legacy-format formula (see
  "Verified conventions"). flam3 writes one or the other depending on target
  version; writing both is the superset that satisfies either reader
  generation (flam3 and Fractorium read `color_speed`; older Apophysis builds
  only knew `symmetry`). They agree by construction, so no reader can be
  misled by preferring either, and flam3's document-ordered parser lands on
  the same value whichever it sees last. Its one side effect lines up: that
  parser also derives `animate` from `symmetry`, so a `color_speed="0"` map
  writes `symmetry="1"` and is left out of rotational animation — exactly as
  a flam3 symmetry xform should be.
- `<finalxform>` is written with `color_speed="0"`. flam3 blends the color
  coordinate _through_ its final xform (at a default speed of 0.5, which
  would pull every plotted point halfway toward that slot and shift the whole
  image); our lens is applied at plot time and never recolors, so speed 0 is
  the value that makes a flam3 render agree with ours. The final map's own
  `colorIndex` still rides along, inert, for tools that display it.
- The 256-entry palette block is the scene's resolved gradient palette
  (`resolvePalette` → `buildPaletteLUT`), or the per-transform hues laid out
  as equal blocks for the `"legacy"` palette.
- The header frames the image from a short seeded chaos probe's trimmed 2D
  bounds (`center`/`scale`), and maps the tone-map back:
  `brightness = 4·exposure`, `gamma`, `vibrancy`, `supersample`,
  `estimator_*`.

## Xaos (per-transform chaos rows)

flam3's xaos — Mauldin–Williams graph-directed selection — round-trips
through `Transform.chaos` (`chaos-game.ts`'s vocabulary; see its own doc
comment for the row/column convention and `resolveChaosEntry`/
`chaosRowIsNonTrivial`, the ONE definitions this module reuses rather than
restates).

- **Attribute form.** `chaos="s0 s1 s2 …"` on a standard `<xform>`: entry `j`
  scales the probability of picking base xform `j` (document order) as the
  NEXT map, when THIS xform was the one just applied — flam3's row-is-FROM,
  entry-is-TOWARD convention, unchanged.
- **Pad/truncate.** flam3's own parser rule: entries missing past the end of
  the list default to `1`; entries past the file's base-xform count are
  ignored. Both fall out of `resolveChaosEntry`'s "absent reads as 1" rule
  for free — import never pads or truncates the array by hand, it just reads
  whichever index the base count asks for.
- **Sanitize, at this trust boundary.** A `chaos` attribute comes from
  untrusted file text, so each parsed entry is resolved through
  `resolveChaosEntry` immediately: a non-finite token (unparseable text, or a
  literal `nan`/`inf`) reads as `1` (the domain's own "absent means 1" rule,
  rather than a second one invented for this file), and a negative entry
  clamps to `0` (`resolveChaosEntry`'s own domain — a negative scale has no
  probability meaning). A stored `Transform.chaos` entry is therefore always
  a finite number `>= 0` on import, which also sidesteps a real hazard:
  `persist.ts`'s wire is JSON, where `NaN`/`Infinity` serialize as `null` and
  would silently drop the WHOLE row on the next decode (`decodeChaosRow`'s
  whole-row-or-nothing rule) — sanitizing at the parse boundary means that
  failure mode never reaches the encoded scene at all.
- **The ordering hazard.** flame-file's import folds pure-linear blends,
  drops malformed/non-positive-weight xforms, and truncates past
  `MAX_TRANSFORMS` — any of which changes what column `j` in a surviving row
  means. The rule: an xform the import drops loses BOTH its own row and its
  column in every surviving row; the survivors keep document order and their
  columns close back up around the gap. Implemented as a two-pass reindex:
  parse every surviving xform's row in RAW file-column order first, then once
  every xform has been visited and the survivors are known, remap each row
  through the list of raw indices that survived (a raw column past the row's
  own length still resolves through `resolveChaosEntry`'s pad rule, so pad,
  truncate and the column-drop are one mechanism, not three).
- **Final xforms sit outside selection**, exactly as in flam3: no row is read
  off a `<finalxform>`'s `chaos` attribute (if a hand-edited file even
  carries one), and no base row's column ever addresses the final transform
  — the base-xform column space only ever spans the standard `<xform>` list,
  in both directions.
- **Trivial rows.** A row that resolves to all-`1`s — absent, explicit
  `"1 1 1"`, or truncated down to nothing but `1`s — is OMITTED from the
  imported `Transform`, exactly `chaosRowIsNonTrivial`'s definition of
  trivial: it selects exactly as no row at all, so storing it would be
  noise.
- **Export gate.** A `chaos` attribute is written on an xform only when the
  SYSTEM carries at least one non-trivial row (`systemHasChaos`) — flam3's
  own `flam3_check_unity_chaos` disabling, and our absent-means-classic
  convention agreeing for once by construction. When the gate is on, EVERY
  exported xform gets a `chaos="…"` attribute, including one whose own row
  is trivial (written as explicit `1`s) — matching flam3's writer, which
  emits the full per-xform array once any xform in the genome uses one,
  rather than mixing explicit and implicit rows in one file. When the gate
  is off, no xform anywhere gets the attribute — an unauthored document
  exports byte-identically to one predating chi.
- **Kaleidoscope-baked export.** Our kaleidoscope copies bake into explicit
  xforms (see "Export" above); chi selection lives at the BASE-map level
  (the sector sweep that picks a copy is orthogonal to it), so every copy of
  a base map inherits that base's row verbatim, and the row itself EXPANDS:
  the column toward every copy of base `j` carries base `j`'s entry,
  regardless of which copy. A 2-map, order-2 system's base-0 row `[a, b]`
  therefore exports as the 4-entry row `[a, b, a, b]` on BOTH copies of base
  0 (and base 1's row the same way on both of its copies) — reproducing the
  base-level selection graph exactly, since a copy's own identity never
  affects which BASE map gets picked next.
- **Round-trip.** Import → export → import preserves `Transform.chaos` rows
  exactly (up to the wire's usual 4-decimal rounding): nothing about a row
  is approximated in either direction, unlike the fold radii or the schedule
  block.

## Known losses (by design)

- z / w structure (projection — warned).
- Animation/motion attributes, per-xform opacity.
- A final xform's color blending (export — our lens doesn't recolor, so the
  export pins its `color_speed` to 0 rather than reproducing an imported
  one; see the export notes above).
- `post` on nonlinear xforms (import — warned).
- The ~90 flam3/Apophysis variations we don't implement (import — warned,
  aggregated). The affine skeleton still imports, which often preserves the
  large-scale composition.
- The reverse case (export — no warning, since nothing about the written XML
  is invalid): our Mandelbox fold family and the two power maps aren't flam3
  variations at all, so a `boxfold`/`spherefold`/`mandelbox`/`qsquare`/`bulb`
  attribute is inert in every other flam3/Apophysis tool. See "A deliberate
  deviation" above.
- A fold variation's custom `minRadius`/`fixedRadius`/`boxLimit` (export —
  **warned**): flam3 XML has no attribute for them, so the exported
  shape always reads back at the classic Mandelbox lengths. Absent or
  explicitly-classic lengths lose nothing and warn nothing. See "A deliberate
  deviation" above.
- A shape emitter (condensation) (export — **warned**): no faithful flam3
  equivalent exists (the lossy disc-emitter ≈ `gaussian_blur` idea is
  recorded in the epic's brief and deliberately deferred), so an emitter
  transform exports as its plain affine map — weight, color and chaos row
  intact, the stamped shape lost.
- Our kaleidoscope exports as baked xforms, so re-importing an export returns
  plain maps (the symmetry metadata itself doesn't round-trip).
- Camera pose (flame files have no 3D camera).

## Verified conventions (for future maintainers)

- `coefs`/`post` order is `a b c d e f` with **columns** `(a, b)`, `(c, d)`,
  translation `(e, f)` — i.e. `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
  This matches flam3's parser (`c[0][0] c[0][1] c[1][0] c[1][1] c[2][0]
c[2][1]`) and Apophysis' writer; both tools agree, y-up, no flips.
- The xform `symmetry` attribute is _color speed_, not geometric symmetry —
  the pre-2.8 spelling `color_speed`/`animate` superseded. Read from flam3's
  own source: its parser loops the attribute list in document order
  (`for (cur_att = att_ptr; cur_att; cur_att = cur_att->next)`) and maps
  `symmetry` to `color_speed = (1 - value) / 2` **plus**
  `animate = value > 0 ? 0 : 1`, while `color_speed` and `animate` each also
  parse directly. So flam3 has no name precedence between the two — last
  attribute wins — and its writer (`flam3_print_xform`) emits
  `symmetry = 1 - 2·color_speed` for the legacy format, `color_speed`
  otherwise. We prefer `color_speed` on import (order-independent) and write
  both, consistently, on export.
- `weight` is a relative pick probability, like ours.
- flam3's default `brightness` is 4 ↔ our default `exposure` is 1. The
  exchange is a control convention, not a byte-exactness claim: our tone-map
  anchors its log-density curve on the MEAN deposited density
  (`log1p(h / mean) / log1p(32)` — `FlameHistogram.hitMass`, see `flame.ts`),
  which is the same shape flam3's own `rect.c` computes (`k1 · log(1 + c[3] ·
k2)` with `k2 ∝ 1/(area · sample_density)`), so an imported file's
  `brightness` now behaves comparatively like flam3's would rather than being
  skewed by whichever render lands the hottest bucket. The factor itself
  (`BRIGHTNESS_PER_EXPOSURE` in `flame-file.ts`) is kept at 4 pending the
  differential-render harness against a real flam3 build; exact per-file
  brightness parity is not certified.
