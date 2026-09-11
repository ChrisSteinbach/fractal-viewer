#!/usr/bin/env node
/** EXPERIMENT-ONLY: composes `#v1=` scene documents for the restored
 * participating medium's god-ray visual test, on top of the cathedral
 * starter `scripts/medium-cost.measure.mjs` already mints.
 *
 * Usage:
 *   node scripts/medium-cost.measure.mjs --label=mint --cap=1
 *   node scripts/medium-shafts-scene.mjs --list
 *   node scripts/medium-shafts-scene.mjs --name=backlit \
 *     --out=scripts/out/medium-shafts
 *   node scripts/medium-shafts-scene.mjs --name=backlit --nomist \
 *     --out=scripts/out/medium-shafts
 *
 * Each named composer returns a camera pose (via `cameraFromEyeTarget`,
 * the same spherical convention as `src/app/orbit.ts`'s
 * `sphericalFromCartesian`) plus a `surface.lighting` rig (lights, ambient,
 * medium) authored against the cathedral starter's own Menger-sponge
 * geometry (a 20-map, single-level IFS whose chaos-game attractor is the
 * FULL infinite-depth sponge — every solid face is itself perforated at
 * every smaller scale, so a wall is Swiss cheese all the way down and the
 * cross-shaped void through the center is open air joining all three axis
 * tunnels). The starter's own transforms/finish/background are left alone;
 * only `camera` and `surface.lighting` are replaced.
 *
 * `--nomist` zeroes `medium.density` for the matching no-mist control,
 * keeping camera/lights identical so the two frames differ ONLY in the
 * medium.
 *
 * Writes `<out>/<name>[-nomist].json` and `<out>/<name>[-nomist].hash.txt`
 * (a bare `v1=...` string, consumable by
 * `medium-cost.measure.mjs --hashfile=...`).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = {
  base: "scripts/out/medium-cost/cathedral.scene.json",
  out: "scripts/out/medium-shafts",
  name: "",
  nomist: false,
  list: false,
  density: null,
  anisotropy: null,
  intensity: null,
  ambient: null,
};
for (const raw of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (!match) throw new Error(`Invalid argument ${raw}`);
  const [, key, value] = match;
  if (key === "list") args.list = true;
  else if (key === "nomist") args.nomist = true;
  else if (Object.hasOwn(args, key) && value !== undefined) args[key] = value;
  else throw new Error(`Unknown or incomplete option ${raw}`);
}
if (args.density !== null) args.density = Number(args.density);
if (args.anisotropy !== null) args.anisotropy = Number(args.anisotropy);
if (args.intensity !== null) args.intensity = Number(args.intensity);
if (args.ambient !== null) args.ambient = Number(args.ambient);

/** Camera eye looking toward `lookAt`, in the same spherical convention as
 * `src/app/orbit.ts` (`OrbitCamera.position() === target + sphericalToCartesian`). */
function cameraFromEyeTarget(eye, lookAt, fov = 75) {
  const offset = [eye[0] - lookAt[0], eye[1] - lookAt[1], eye[2] - lookAt[2]];
  const radius = Math.hypot(...offset);
  const theta = Math.atan2(offset[0], offset[2]);
  const phi = Math.acos(Math.max(-1, Math.min(1, offset[1] / radius)));
  return { target: lookAt, radius, theta, phi, fov };
}

const normalize = (v) => {
  const len = Math.hypot(...v);
  return v.map((x) => x / len);
};

// The starter's own bounding cube is ~[-H, H]^3 with H ~= 0.75 -- the map's
// translation range alone predicts this (positions in {-0.5,0,0.5} at the
// IFS's fixed-point ratio 1.5x out), and `diagFar`/`diagNear` below (kept as
// diagnostics; see this script's git history for the render) confirmed it
// directly: a camera at z=1.6 sits close in front of the near face, and a
// camera at the origin looking down +x sees a receding tunnel with its far
// exit still visible as a small dark square, both consistent with H ~= 0.75.
// (An earlier pass mis-derived H = 0.4 from the starter's SAVED camera pose,
// wrongly assuming that pose was a tight bounding-sphere fit; it is just an
// authored framing angle. That estimate put every off-axis composition still
// inside the open tunnel instead of in the solid perforated wall intended.)
// The removed face-center/center sub-cubes at level 1 form a cross-shaped
// open tunnel of half-width T ~= H/3 ~= 0.25 through the middle along all
// three axes.

/** Named compositions. Each returns `{ camera, lighting }`. */
const COMPOSERS = {
  // The main cross-tunnel is a UNION along all three axes near the origin
  // (inside the x-tunnel's |y|,|z| < T corridor OR the y-tunnel's OR the
  // z-tunnel's), so a camera near the crossing looking any axis-ish
  // direction re-enters an open shaft rather than hitting a wall -- exactly
  // the bug an earlier pass had here (see this script's git history: both
  // "look up the y-tunnel" and "look along x offset by less than T" still
  // rendered a glowing open shaft, not a backlit wall). This composition
  // steps the camera OUT of every tunnel's corridor first (y = 0.35 > T
  // clears both the x- and z-tunnels at this x, and x = 0.05..0.5 stays
  // clear of the y-tunnel too since |y| is already 0.35 > T there), so the
  // view ahead is genuine solid perforated wall, with a small bright light
  // just past it aimed back through the holes.
  backlit: () => ({
    camera: cameraFromEyeTarget([0.05, 0.35, 0.02], [0.55, 0.35, 0.02], 75),
    lighting: {
      lights: [
        {
          position: [0.85, 0.35, 0.02],
          normal: [-1, 0, 0],
          radius: 0.05,
          color: [1, 0.92, 0.8],
          intensity: 9,
        },
      ],
      ambient: [0.004, 0.004, 0.005],
      specular: 0.12,
      roughness: 0.5,
      medium: {
        center: [0.35, 0.35, 0.02],
        radius: 0.45,
        density: 0.6,
        tint: [0.95, 0.95, 1],
        anisotropy: 0.75,
      },
    },
  }),
  // A light well above the cube shines down through ceiling perforations;
  // the camera stays low INSIDE the open x-tunnel (|y|, |z| < T, so this one
  // deliberately does not leave the shaft), looking along its length, so the
  // tunnel's own perforated ceiling recedes overhead and whichever of its
  // holes catch the light show as shafts crossing the horizontal view
  // (grazing angle, low anisotropy) rather than a single shaft pointing
  // back at the camera.
  ceiling: () => ({
    camera: cameraFromEyeTarget([-0.5, 0.05, 0.02], [0.5, 0.05, 0.02], 80),
    lighting: {
      lights: [
        {
          position: [0.15, 1.0, 0.02],
          normal: [0, -1, 0],
          radius: 0.05,
          color: [1, 0.96, 0.88],
          intensity: 9,
        },
      ],
      ambient: [0.004, 0.004, 0.005],
      specular: 0.12,
      roughness: 0.5,
      medium: {
        center: [0, 0.28, 0.02],
        radius: 0.65,
        density: 0.6,
        tint: [0.95, 0.95, 1],
        anisotropy: 0.15,
      },
    },
  }),
  // Own composition: the backlit wall seen at an oblique ~45 degree
  // incidence instead of head-on, with the light offset to match -- tests
  // whether shafts still read when the hole lattice and the medium's
  // in-scatter cone are both seen at a grazing angle rather than face-on.
  oblique: () => ({
    camera: cameraFromEyeTarget([0.05, 0.35, 0.02], [0.5, 0.55, 0.35], 80),
    lighting: {
      lights: [
        {
          position: [0.75, 0.65, 0.55],
          normal: [-0.7, -0.5, -0.5],
          radius: 0.05,
          color: [1, 0.9, 0.78],
          intensity: 9,
        },
      ],
      ambient: [0.004, 0.004, 0.005],
      specular: 0.12,
      roughness: 0.5,
      medium: {
        center: [0.35, 0.45, 0.25],
        radius: 0.5,
        density: 0.6,
        tint: [0.95, 0.95, 1],
        anisotropy: 0.4,
      },
    },
  }),
  // Camera pulled well back from the solid wall (not tucked into one small
  // niche the way "backlit" is), so a wide swath of the recursive hole
  // lattice is in frame at once -- the classic "sunlight through a grille"
  // shot, with a long air path between camera and wall for the medium to
  // show distinct per-hole beams rather than one glowing niche.
  facade: () => ({
    camera: cameraFromEyeTarget([-0.3, 0.35, 0.05], [0.5, 0.35, 0.05], 70),
    lighting: {
      lights: [
        {
          position: [0.9, 0.35, 0.05],
          normal: [-1, 0, 0],
          radius: 0.08,
          color: [1, 0.92, 0.8],
          intensity: 15,
        },
      ],
      ambient: [0.006, 0.006, 0.007],
      specular: 0.12,
      roughness: 0.5,
      medium: {
        center: [0.2, 0.35, 0.05],
        radius: 0.6,
        density: 0.6,
        tint: [0.95, 0.95, 1],
        anisotropy: 0.6,
      },
    },
  }),
  // Camera well back inside the long open x-tunnel (the same corridor
  // `diagNear` found), light placed OUTSIDE the tunnel's far mouth but
  // OFFSET well off-axis in y. Only points inside the tunnel whose sightline
  // to the light happens to thread the mouth's finite opening get lit, which
  // carves a wedge-shaped beam through the tunnel's own air instead of a
  // centered glow -- meant to put a lit wedge and the tunnel's unlit walls
  // side by side in one frame.
  wedge: () => ({
    camera: cameraFromEyeTarget([0.15, -0.05, 0.05], [0.7, 0.15, 0.05], 85),
    lighting: {
      lights: [
        {
          position: [1.0, 0.55, 0.05],
          normal: [-0.4, -0.9, 0],
          radius: 0.08,
          color: [1, 0.92, 0.8],
          intensity: 15,
        },
      ],
      ambient: [0.005, 0.005, 0.006],
      specular: 0.12,
      roughness: 0.5,
      medium: {
        center: [0.45, 0.1, 0.05],
        radius: 0.55,
        density: 0.6,
        tint: [0.95, 0.95, 1],
        anisotropy: 0.6,
      },
    },
  }),
  // "wedge" with a SECOND off-axis light offset in z instead of y (both
  // lights allowed by the rig's 2-light cap): two independent wedges should
  // carve two differently angled lit corridors through the same tunnel air,
  // testing whether multiple simultaneous shafts read as separate columns
  // rather than merging into one wash.
  wedge2: () => ({
    camera: cameraFromEyeTarget([0.15, -0.05, 0.05], [0.7, 0.15, 0.05], 85),
    lighting: {
      lights: [
        {
          position: [1.0, 0.55, 0.05],
          normal: [-0.4, -0.9, 0],
          radius: 0.08,
          color: [1, 0.85, 0.7],
          intensity: 15,
        },
        {
          position: [1.0, -0.05, 0.55],
          normal: [-0.4, 0, -0.9],
          radius: 0.08,
          color: [0.6, 0.8, 1],
          intensity: 15,
        },
      ],
      ambient: [0.005, 0.005, 0.006],
      specular: 0.12,
      roughness: 0.5,
      medium: {
        center: [0.45, 0.1, 0.05],
        radius: 0.55,
        density: 0.6,
        tint: [0.95, 0.95, 1],
        anisotropy: 0.6,
      },
    },
  }),
  // DIAGNOSTIC ONLY (no cinematic rig): classic lighting, camera pulled well
  // back on-axis so the whole starter cube is in frame, to calibrate its
  // real extent by eye rather than by inference.
  diagFar: () => ({
    camera: cameraFromEyeTarget([0, 0, 1.6], [0, 0, 0], 50),
    lighting: null,
  }),
  // DIAGNOSTIC ONLY: camera near the origin looking down +x, wide FOV, to
  // see whether the origin neighborhood is open air and how far the first
  // solid material is.
  diagNear: () => ({
    camera: cameraFromEyeTarget([-0.02, 0, 0], [1, 0, 0], 100),
    lighting: null,
  }),
};

if (args.list) {
  console.log(Object.keys(COMPOSERS).join("\n"));
  process.exit(0);
}
if (!args.name || !Object.hasOwn(COMPOSERS, args.name)) {
  throw new Error(
    `--name must be one of: ${Object.keys(COMPOSERS).join(", ")}`,
  );
}

const base = JSON.parse(await readFile(args.base, "utf8"));
const { camera, lighting } = COMPOSERS[args.name]();
if (lighting) {
  if (args.density !== null) lighting.medium.density = args.density;
  if (args.anisotropy !== null) lighting.medium.anisotropy = args.anisotropy;
  if (args.intensity !== null) {
    for (const light of lighting.lights) light.intensity = args.intensity;
  }
  if (args.ambient !== null) {
    lighting.ambient = [args.ambient, args.ambient, args.ambient * 1.1];
  }
  if (args.nomist) lighting.medium.density = 0;
}

const document = structuredClone(base);
document.camera = camera;
if (lighting) {
  document.surface = { ...document.surface, lighting };
} else {
  document.surface = { ...document.surface };
  delete document.surface.lighting;
}

const encoded = `v1=${Buffer.from(JSON.stringify(document)).toString("base64url")}`;
await mkdir(args.out, { recursive: true });
const suffix = args.nomist ? "-nomist" : "";
const jsonPath = path.join(args.out, `${args.name}${suffix}.json`);
const hashPath = path.join(args.out, `${args.name}${suffix}.hash.txt`);
await writeFile(jsonPath, JSON.stringify(document, null, 2));
await writeFile(hashPath, encoded);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${hashPath}`);
console.log(
  lighting
    ? `medium density=${lighting.medium.density} anisotropy=${lighting.medium.anisotropy}`
    : "diagnostic (no cinematic rig)",
);
