import { DEFAULT_BACKGROUND_SHAPE_CENTER } from "../fractal/background-shape";
import type { SurfaceComputeFrameSpec } from "./surface-compute";

/**
 * The offline-export force-frame memo key (`ensureSurfaceComputeForceFrame`,
 * main.ts), pulled out of main.ts's closure so it can be tested without the
 * app's whole boot sequence — `capture-cost.ts`'s pattern applied to the
 * force-frame door: the function was already a pure `(spec) => string`, so
 * extraction cost nothing but the move.
 *
 * `ensureSurfaceComputeForceFrame` re-presents the LAST traced frame instead
 * of re-tracing whenever this key comes back unchanged, so the key's whole
 * job is to change exactly when the shaded pixels would. Missing a field
 * here does not throw or warn — it silently re-presents a stale frame for as
 * long as that field is the only thing moving, which is how the
 * stale-atmosphere-leg bug was found: `fogDensity`/`fogTint`/
 * `fogTintStrength`, `envLight` and the backdrop SHAPE triple
 * `bgShape`/`bgCenter`/`bgScale` all landed on
 * {@link SurfaceComputeFrameSpec} after this key did, and none of the three
 * ever got added to it. A timeline leg that changes only one of those under
 * a parked camera — an atmosphere-only leg, not a rare shape — exported the
 * PREVIOUS leg's frame for its whole dwell.
 *
 * THE COLLISION HAZARD: this is a plain array `.join("|")`, so appending
 * fields blind can make two DIFFERENT specs key IDENTICALLY. Two properties
 * keep it safe. First, no field ever contributes a string containing `"|"` —
 * every element is either a plain JS number, a comma-joined tuple of numbers,
 * or a short lowercase tag literal — so the join is injective over the
 * ordered element list (splitting the result on `"|"` always recovers exactly
 * the list that was joined; there is no second way to have produced the same
 * string). Second, every OPTIONAL block (`view4`, `balloon`, `groundPlane`,
 * and now `bgShape`) is fixed-length when present and zero-length when
 * absent, and every one of them but `view4` (whose contents are always
 * numeric, so it can never start with a word) opens with a tag literal that
 * no numeric field, and no other block's tag, can ever equal. So no
 * combination of present/absent optional blocks can be re-partitioned into a
 * DIFFERENT combination that reads the same —
 * `surface-force-frame-key.test.ts`'s collision case pins exactly that for
 * the new `bgShape` block against its neighbors. The `finish` block relaxes
 * "fixed-length when present" to SELF-DELIMITING: it opens with its tag and
 * then its own slot COUNT, so a parse knows exactly where it ends however
 * many slots a session has — the same injectivity, one indirection later.
 */
export function surfaceComputeForceFrameKey(
  spec: SurfaceComputeFrameSpec,
): string {
  return [
    Array.from(spec.invProjView).join(","),
    spec.width,
    spec.height,
    spec.lutVersion,
    spec.ambient,
    // Environment light: tints the shade entry's AMBIENT term toward the
    // sampled backdrop, changing hit pixels exactly like ambient itself —
    // keyed beside it for the same reason. Defaults to 0 (untinted),
    // matching packSurfaceGpuShade's own envStrength default.
    spec.envLight ?? 0,
    spec.colorSource,
    spec.colorSpeed,
    spec.lightDir.join(","),
    // The backdrop stops: a background change/crossfade must re-trace the
    // memoized force frame — miss pixels carry the gradient.
    spec.bgTop.join(","),
    spec.bgBottom.join(","),
    // Depth fog: the shade kernel's fog attenuates every distant hit and
    // blends toward fogTint, so a density/tint/strength change repaints
    // hit pixels the same way a bgTop/bgBottom change repaints misses —
    // the stops' own rationale, one level down. Defaults match
    // packSurfaceGpuShade's own: density 1 (the fixed fog it replaced),
    // tint white, strength 0 (fog toward the pixel's own backdrop alone).
    spec.fogDensity ?? 1,
    (spec.fogTint ?? [1, 1, 1]).join(","),
    spec.fogTintStrength ?? 0,
    // The session's authored finishes: a timeline leg whose document
    // authors a different finish on some transform repaints every hit
    // pixel under a parked camera — fog's own rationale, per slot. Keyed
    // on spec.finishes' OWN presence, which matches the shadeMaps
    // packer's absent default exactly (absent spec = the classic kernels
    // = the pre-finish buffer); the RESOLVED six-number lanes per slot
    // need no further defaulting because resolution is total. Tag + slot
    // COUNT then one comma-tuple per slot — self-delimiting rather than
    // fixed-length; see the module doc's collision argument.
    ...(spec.finishes
      ? [
          "finish",
          spec.finishes.length,
          ...spec.finishes.map((f) =>
            [
              f.specular,
              f.shininess,
              f.metalness,
              f.reflect,
              f.transmit,
              f.reflectionTint,
            ].join(","),
          ),
        ]
      : []),
    // The background SHAPE: linear vs radial, or a radial
    // recenter/rescale, changes every miss and fog-blended pixel exactly
    // like the stops above. A distinct "bgShape" tag plus a fixed
    // 4-element count (tag, kind, center, scale) when present — the module
    // doc's collision argument — so it can never be re-read as part of the
    // view4/balloon/groundPlane blocks below, or vice versa. Keyed on
    // spec.bgShape's OWN presence, matching their precedent; center/scale
    // default the same way packSurfaceGpuShade's own absent-field
    // resolution does.
    ...(spec.bgShape
      ? [
          "bgShape",
          spec.bgShape.kind,
          (spec.bgShape.center ?? DEFAULT_BACKGROUND_SHAPE_CENTER).join(","),
          (spec.bgShape.scale ?? [1, 1]).join(","),
        ]
      : []),
    // The 4D pose: a timeline leg glides rotor/slice with the camera
    // parked, so a key without them would re-present a stale pose across
    // every dwell frame of the glide.
    ...(spec.view4
      ? [
          Array.from(spec.view4.rotor).join(","),
          spec.view4.w0,
          spec.view4.sliceHalfW,
        ]
      : []),
    // The balloon block: a parked camera with an R sweep must never
    // re-present a stale frame — the 4D pose-triple precedent. The
    // "balloon" literal is the on-flag; the block exists exactly when
    // the session's kernels carry the wrapper.
    ...(spec.balloon
      ? [
          "balloon",
          spec.balloon.center.join(","),
          spec.balloon.rho,
          spec.balloon.R,
          spec.balloon.far,
          // Balloon tint: INSIDE this block, not a sibling — without the
          // wrapper the kernel emits no mix at all, so a tint change
          // means nothing outside a balloon session. The offline-export
          // memo must not re-present a stale frame when a timeline leg
          // changes the tint under a parked camera — the balloon block's
          // own reason above. balloonTint/ balloonTintStrength are
          // optional on the spec type (like fogTint/fogTintStrength);
          // default the same way packSurfaceGpuShade's own absent-field
          // default does (fractal/surface-de-gpu.ts).
          (spec.balloonTint ?? [0, 0, 0]).join(","),
          spec.balloonTintStrength ?? 0,
        ]
      : []),
    // The ground plane block: the balloon block's own precedent one
    // level up — a parked camera with the floor toggled must never
    // re-present a stale frame. The "groundPlane" literal is the
    // on-flag; the block exists exactly when the session's kernels
    // carry the plane arm (never alongside "balloon" above — the two
    // are mutually exclusive by construction).
    ...(spec.groundPlane
      ? [
          "groundPlane",
          spec.groundPlane.y,
          spec.groundPlane.fadeStart,
          spec.groundPlane.fadeEnd,
          spec.groundPlane.ballCenter.join(","),
          spec.groundPlane.ballRadius,
          spec.groundPlane.albedo.join(","),
          spec.groundPlane.pattern ?? 0,
          spec.groundPlane.tileScale ?? 0.64,
          spec.groundPlane.emission ?? 0,
        ]
      : []),
  ].join("|");
}
