# `.flame` interop (fr-8uy5)

How Fractal Explorer's scene vocabulary maps onto the flam3/Apophysis `.flame` XML
format, and exactly where the mapping is lossy. Implemented by
`src/app/flame-file.ts` (`decodeFlameFile` / `encodeFlameFile`), reachable
through the same panel buttons and drag-drop as the JSON scene files
(fr-de9t).

## Why the mapping is mostly exact

Three facts line the two vocabularies up better than they first appear:

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
   planar dynamics exactly. (The other three — `boxfold`, `spherefold`,
   `mandelbox` — are ours, not flam3's; see "A deliberate deviation" below.)

3. **The lens matches.** flam3's `<finalxform>` is applied at plot time and
   never fed back into the orbit — precisely our `finalTransform`.

## A deliberate deviation: the fold family isn't flam3's

Fact 2 above has a carve-out. Twelve of our fifteen `VARIATION_TYPES` are
flam3's own attribute names; the Mandelbox fold family — `boxfold`,
`spherefold`, `mandelbox` (fr-p7nu) — is ours. flam3 and Apophysis have no
plain variation attributes by these names at all — their Mandelbox-adjacent
features live in separately parameterized plugins with different names and
different formulas, not a drop-in match — so there was no existing name being
claimed or collided with when the fold family was added.

Two consequences follow, both accepted on purpose rather than discovered
after the fact:

- **Export.** A scene using a fold variation writes a `boxfold`/`spherefold`/
  `mandelbox` attribute no other flam3/Apophysis tool defines — the shape
  degrades there exactly as any unrecognized variation would. Our own
  importer round-trips it exactly, because it's reading its own name back.
- **Import.** A foreign `.flame` file that happens to carry an attribute
  literally named `boxfold`, `spherefold`, or `mandelbox` — essentially never
  from a genuine flam3/Apophysis export, conceivably from a hand-edited file
  or another tool's own extension — is read as our fold variation, not
  flagged as unsupported. It no longer contributes to the aggregated
  unknown-variations warning, because the name-matching import path can't
  tell it apart from a real one.

`VARIATION_NAMES` (the set `decodeFlameFile`/`encodeFlameFile` match against)
stays mechanically derived from `VARIATION_TYPES` — one array, not a
flam3-only subset — by design: special-casing the fold family out of
import/export would trade away our own round-trip fidelity for strict
flam3-name purity, and round-tripping our own exports exactly was judged the
more valuable property to protect.

## Import (`.flame` → scene)

| flame                                                | explorer                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `coefs`                                              | QR → position/rotation/scale/shear (exact)                                                          |
| pure `linear="w"` blend                              | folded into the affine (`w·A`, `w·t`), list omitted (exact)                                         |
| known variation attrs                                | `variations: [{type, weight}]` by name (exact)                                                      |
| `post` on a purely affine map                        | composed into the affine (exact)                                                                    |
| `post` on a nonlinear map                            | **dropped + warning** (nothing to hang it on)                                                       |
| unknown variations/parameters                        | **ignored + one aggregated warning** naming the attributes                                          |
| `weight`                                             | `Transform.weight`; all-equal weights omitted (uniform)                                             |
| `weight ≤ 0` xform                                   | **skipped + warning**                                                                               |
| `chaos` (xaos)                                       | **ignored + warning** (no xaos in the chaos game)                                                   |
| `opacity="0"`                                        | imported visible + warning (no per-map opacity)                                                     |
| `color`, `symmetry`/`color_speed`                    | ignored (our color modes are global, not per-xform indices)                                         |
| `<finalxform>`                                       | `finalTransform` (same rules; its weight ignored)                                                   |
| palette (`<palette>` hex block or `<color>` entries) | downsampled onto an 8-stop `CustomPalette`; `flame.paletteId` and `rampPaletteId` become `"custom"` |
| `brightness` / `gamma` / `vibrancy`                  | `flame.exposure` (`brightness / 4`) / `gamma` / `vibrancy`, clamped to our ranges                   |
| `supersample`/`oversample`, `estimator_*`            | the matching `FlameParams` fields, clamped                                                          |
| `size`/`center`/`scale`/`rotate`                     | ignored — the explorer auto-fits its own camera                                                     |

"Known variation attrs" matches any of our fifteen `VARIATION_TYPES` by name
— fold family included, per the deviation above. A genuine flam3/Apophysis
file essentially never carries a `boxfold`/`spherefold`/`mandelbox`
attribute, but one that does gets read as our fold variation rather than
flagged as an unsupported feature.

Everything else about the imported scene (point count, render style, color
mode, …) takes the app's defaults. A file with several `<flame>` elements
imports every one (capped at the collection size); the UI loads a single
flame as the current scene and merges a multi-flame file into the collection.

`decodeFlameFile` is a never-throwing trust boundary like `scene-file.ts`'s
`decodeImportFile`: unusable input returns `null` (not a flame file) or drops
individual flames with warnings, and every returned `encoded` string has
already passed `decodeScene` — a returned scene is genuinely loadable.

## Export (scene → `.flame`)

The export writes the system's **XY shadow**:

- Exact for z-flat systems — in particular, anything that was imported from a
  `.flame` round-trips exactly (up to 4-decimal rounding).
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
- `finalTransform` → `<finalxform>`; variations pass through by name (merged
  by type — XML attributes must be unique); weights pass through as-is.
- Per-xform `color` indices are spread `i / (n - 1)` and the 256-entry
  palette block is the scene's resolved gradient palette
  (`resolvePalette` → `buildPaletteLUT`), or the per-transform hues laid out
  as equal blocks for the `"legacy"` palette.
- The header frames the image from a short seeded chaos probe's trimmed 2D
  bounds (`center`/`scale`), and maps the tone-map back:
  `brightness = 4·exposure`, `gamma`, `vibrancy`, `supersample`,
  `estimator_*`.

## Known losses (by design)

- z / w structure (projection — warned).
- Per-xform palette coordinates and color speed (import).
- Xaos, animation/motion attributes, per-xform opacity.
- `post` on nonlinear xforms (import — warned).
- The ~90 flam3/Apophysis variations we don't implement (import — warned,
  aggregated). The affine skeleton still imports, which often preserves the
  large-scale composition.
- The reverse case (export — no warning, since nothing about the written XML
  is invalid): our Mandelbox fold family isn't a flam3 variation at all, so a
  `boxfold`/`spherefold`/`mandelbox` attribute is inert in every other
  flam3/Apophysis tool. See "A deliberate deviation" above.
- Our kaleidoscope exports as baked xforms, so re-importing an export returns
  plain maps (the symmetry metadata itself doesn't round-trip).
- Camera pose (flame files have no 3D camera).

## Verified conventions (for future maintainers)

- `coefs`/`post` order is `a b c d e f` with **columns** `(a, b)`, `(c, d)`,
  translation `(e, f)` — i.e. `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
  This matches flam3's parser (`c[0][0] c[0][1] c[1][0] c[1][1] c[2][0]
c[2][1]`) and Apophysis' writer; both tools agree, y-up, no flips.
- The xform `symmetry` attribute is _color speed_, not geometric symmetry.
- `weight` is a relative pick probability, like ours.
- flam3's default `brightness` is 4 ↔ our default `exposure` is 1.
