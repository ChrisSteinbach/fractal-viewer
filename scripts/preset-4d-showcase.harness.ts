/**
 * The 4D showcase presets' design sheet — the executable record behind the
 * six 4D presets added alongside it (flame: `hopfBloom`, `juliaStrata`,
 * `pentatopePinwheel`; surface: `turnedShells`, `brickRosette`,
 * `hyperkifs`). It renders each system the way its renderer will draw it —
 * the flame trio through `accumulateFlame4` at the structural palette, the
 * surface trio through their CPU oracles behind `de-preview.ts`'s marcher —
 * so the figures quoted in the presets' docs can be regenerated, and the
 * framing each preset opens on can be re-judged without a browser.
 *
 * WHAT IT CONCLUDED (and what the shipped preset tests pin in bands):
 *
 *  - `hopfBloom` / `juliaStrata` / `pentatopePinwheel`: all three converge
 *    with every one of the four coordinate extents open (the preset tests
 *    pin bounds and non-flatness). The pinwheel — the pentatope's attractor
 *    through a plot-time `julian` power-3 lens with an `xw` tilt — was the
 *    strongest flame panel measured; the strata's sheets read best at the
 *    authored oblique pose with the app's soft w-slice ON (which is the
 *    state a `PRESET_VIEWS.fourD` entry lands in).
 *  - `turnedShells` (the 4D chain's HEAD link turned `xw 0.3`, the measured
 *    opposite of the power-link turn `hybridChainShells` ships): slice
 *    extent 3.18/4.00/3.99 against the flat chain's 3.99/4.00/3.99, 4-ball
 *    fill 0.476% against 0.415%, and 54.5% of rays at the entry pose
 *    against the flat chain's 74.9% and the shipped shells' 69.1% — the
 *    head turn's measured cost, spent on larger ring/plate structure.
 *  - `brickRosette` (the brick under a three-fold wedge): the order-2
 *    wedge is an EXACT no-op on its rendered slice (0 of 262144 sampled
 *    points change side, IoU 1.000 — the brick keeps its box fold's
 *    mirror), but higher even orders are NOT no-ops here (order 4 moves
 *    5.3%, IoU 0.824) because the brick's `xw` turn breaks every other
 *    mirror — so three-fold (IoU 0.743, 8.1% moved) is the smallest order
 *    that is neither the identity nor a mirror.
 *  - `hyperkifs` (the 4D fold frontier): eligible in
 *    `analyzeSurfaceSystem4` at step scale 1, routes to `core:"fold4"` off
 *    `deHasFolds4`, and its w extent matches its x extent (the preset test
 *    pins the band) — the isotropy that makes its slice sweep productive.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts
 * scripts/preset-4d-showcase.harness.ts
 * Output lands under scripts/out/preset-4d-showcase/ (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeFlameProjection4,
  composeRotorProjection4,
  type FourDView,
} from "../src/fractal/project4";
import { prepareChaosGame4, runChaosGame4 } from "../src/fractal/chaos-game-4d";
import { accumulateFlame4 } from "../src/fractal/flame-4d";
import { createFlameHistogram, tonemapFlame } from "../src/fractal/flame";
import type { Mat4 } from "../src/fractal/flame";
import { encodePng, renderPreview } from "./de-preview";
import type { Vec3 } from "./de-preview";
import { buildPaletteLUT, type FlamePaletteId } from "../src/fractal/palette";
import { mulberry32 } from "../src/fractal/rng";
import {
  buildEscapeDE4,
  estimateEscapeDistance4,
  escapeSetContains4,
  probeEscapeFill4,
} from "../src/fractal/escape-de-4d";
import { buildSurfaceDE4 } from "../src/fractal/surface-de-4d";
import { toTransform4 } from "../src/fractal/affine4";
import type {
  Transform,
  Vec3 as FractalVec3,
  Vec4,
} from "../src/fractal/types";
import {
  brickRosette,
  hopfBloom,
  hyperkifs,
  juliaStrata,
  mandelboxBrick,
  pentatope,
  pentatopePinwheel,
  turnedShells,
} from "../src/fractal/presets";

const OUT = join(import.meta.dirname, "out", "preset-4d-showcase");
mkdirSync(OUT, { recursive: true });

const SIZE_FLAME = 512;
const FLAME_ITERATIONS = 3_000_000;
const SIZE_SURFACE = 300;

// ------------------------------------------------------------------ math

function mul4(a: Mat4, b: Mat4): Mat4 {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out.push(
        a[row * 4] * b[col] +
          a[row * 4 + 1] * b[4 + col] +
          a[row * 4 + 2] * b[8 + col] +
          a[row * 4 + 3] * b[12 + col],
      );
    }
  }
  return out;
}

function rotInPlane(plane: string, a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const idx: Record<string, [number, number]> = {
    xy: [0, 1],
    xz: [0, 2],
    yz: [1, 2],
    xw: [0, 3],
    yw: [1, 3],
    zw: [2, 3],
  };
  const [i, j] = idx[plane];
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  m[i * 4 + i] = c;
  m[j * 4 + j] = c;
  m[i * 4 + j] = -s;
  m[j * 4 + i] = s;
  return m;
}

function rotorFromPlanes(planes: [string, number][]): Mat4 {
  let m = rotInPlane("xy", 0);
  for (const [plane, angle] of planes) m = mul4(rotInPlane(plane, angle), m);
  return m;
}

function sphericalEye(theta: number, phi: number, radius: number): Vec3 {
  const sp = Math.sin(phi);
  return [
    radius * sp * Math.sin(theta),
    radius * Math.cos(phi),
    radius * sp * Math.cos(theta),
  ];
}

/** The app's own camera: row-major `projection * view` (the rows the flame
 * accumulator reads), perspective at the pose's fov, up = +y. */
function lookAtCamera(eye: Vec3, target: Vec3, fovY: number): Mat4 {
  const f: Vec3 = norm3([
    target[0] - eye[0],
    target[1] - eye[1],
    target[2] - eye[2],
  ]);
  const r: Vec3 = norm3([
    f[1] * 0 - f[2] * 1,
    f[2] * 0 - f[0] * 0,
    f[0] * 1 - f[1] * 0,
  ]);
  const u: Vec3 = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  const t: Vec3 = [
    -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]),
    -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]),
    f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
  ];
  const sy = 1 / Math.tan((fovY * Math.PI) / 360);
  const V: Mat4 = [
    r[0],
    r[1],
    r[2],
    t[0],
    u[0],
    u[1],
    u[2],
    t[1],
    -f[0],
    -f[1],
    -f[2],
    t[2],
    0,
    0,
    0,
    1,
  ];
  const P: Mat4 = [
    sy,
    0,
    0,
    0,
    0,
    sy,
    0,
    0,
    0,
    0,
    (1000 + 0.05) / (0.05 - 1000),
    (2 * 1000 * 0.05) / (0.05 - 1000),
    0,
    0,
    -1,
    0,
  ];
  return mul4(P, V);
}

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ------------------------------------------------------------ flame panels

interface FlamePose {
  theta: number;
  phi: number;
  radius: number;
  fov: number;
  rotor: Mat4;
  sliceOn: boolean;
}

const TONEMAP = {
  exposure: 1,
  gamma: 2.4,
  gammaThreshold: 0.01,
  vibrancy: 1,
};

function rgbaToRgb(image: Uint8ClampedArray<ArrayBuffer>): Uint8Array {
  const n = image.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = image[i * 4];
    out[i * 3 + 1] = image[i * 4 + 1];
    out[i * 3 + 2] = image[i * 4 + 2];
  }
  return out;
}

function renderFlame4(
  transforms: Transform[],
  lens: Transform | null,
  palette: FlamePaletteId,
  pose: FlamePose,
  name: string,
): void {
  const t4 = transforms.map(toTransform4);
  const boundsRes = runChaosGame4(t4, 40000, mulberry32(7), null, {
    order: 1,
    plane: "xz",
  });
  const b = boundsRes.bounds;
  const center: Vec4 = [
    (b.minX + b.maxX) / 2,
    (b.minY + b.maxY) / 2,
    (b.minZ + b.maxZ) / 2,
    (b.minW + b.maxW) / 2,
  ];
  const half: Vec4 = [
    (b.maxX - b.minX) / 2,
    (b.maxY - b.minY) / 2,
    (b.maxZ - b.minZ) / 2,
    (b.maxW - b.minW) / 2,
  ];
  const rotor = pose.rotor;
  const support =
    Math.abs(rotor[12]) * half[0] +
    Math.abs(rotor[13]) * half[1] +
    Math.abs(rotor[14]) * half[2] +
    Math.abs(rotor[15]) * half[3];
  const view: FourDView = {
    invWAmp: 1 / Math.max(support, 1e-6),
    sliceOn: pose.sliceOn,
    sliceCenter: 0,
    sliceWidth: 0.12,
    sliceRelativeColor: false,
  };
  const eye = sphericalEye(pose.theta, pose.phi, pose.radius);
  const camera = lookAtCamera(eye, [center[0], center[1], center[2]], pose.fov);
  const projection = composeFlameProjection4(
    camera,
    composeRotorProjection4(rotor, center),
  );
  const prepared = prepareChaosGame4(
    t4,
    lens ? toTransform4(lens) : null,
    { order: 1, plane: "xz" },
    null,
  );
  const lut = buildPaletteLUT(palette);
  if (!lut) throw new Error(`no lut for ${palette}`);
  const hist = createFlameHistogram(SIZE_FLAME, SIZE_FLAME);
  accumulateFlame4(
    prepared,
    projection,
    view,
    SIZE_FLAME,
    SIZE_FLAME,
    FLAME_ITERATIONS,
    mulberry32(1),
    { kind: "structural", lut },
    hist,
  );
  const image = tonemapFlame(hist, TONEMAP);
  writeFileSync(
    join(OUT, `${name}.png`),
    encodePng(SIZE_FLAME, SIZE_FLAME, rgbaToRgb(image)),
  );
  console.log(
    `${name}: w[${b.minW.toFixed(2)},${b.maxW.toFixed(2)}] hitMass=${hist.hitMass}`,
  );
}

// ---------------------------------------------------------- surface panels

function rotorInv(m: Mat4): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) out[r * 4 + c] = m[c * 4 + r];
  return out;
}

function lift4(rotorInvM: number[], w0: number) {
  return (p: Vec3): Vec4 => [
    rotorInvM[0] * p[0] +
      rotorInvM[1] * p[1] +
      rotorInvM[2] * p[2] +
      rotorInvM[3] * w0,
    rotorInvM[4] * p[0] +
      rotorInvM[5] * p[1] +
      rotorInvM[6] * p[2] +
      rotorInvM[7] * w0,
    rotorInvM[8] * p[0] +
      rotorInvM[9] * p[1] +
      rotorInvM[10] * p[2] +
      rotorInvM[11] * w0,
    rotorInvM[12] * p[0] +
      rotorInvM[13] * p[1] +
      rotorInvM[14] * p[2] +
      rotorInvM[15] * w0,
  ];
}

const SURFACE_ROTOR = rotorFromPlanes([
  ["xw", 0.5],
  ["zw", 0.35],
]);
const SURFACE_EYE = sphericalEye(0.62, 1.08, 5.2);

function renderSurface4(
  de: (p: Vec3) => number,
  boundingRadius: number,
  stepScale: number,
  name: string,
): void {
  const panel = renderPreview(
    {
      de,
      boundingRadius,
      eye: SURFACE_EYE,
      stepScale,
      zoom: 0.52,
    },
    SIZE_SURFACE,
  );
  writeFileSync(
    join(OUT, `${name}.png`),
    encodePng(SIZE_SURFACE, SIZE_SURFACE, panel.rgb),
  );
  console.log(
    `${name}: hits ${((100 * panel.hits) / (SIZE_SURFACE * SIZE_SURFACE)).toFixed(1)}%`,
  );
}

// ---------------------------------------------------------------- panels

it("renders the flame trio", () => {
  // The authored poses, from PRESET_VIEWS (preset-view.ts's convention: the
  // listed plane rotations compose in order, first applied first).
  renderFlame4(
    hopfBloom(),
    null,
    "sunset",
    {
      theta: Math.atan2(1.71, 1.84),
      phi: Math.acos(1.12 / Math.hypot(1.71, 1.12, 1.84)),
      radius: Math.hypot(1.71, 1.12, 1.84),
      fov: 55,
      rotor: rotorFromPlanes([
        ["xw", 0.6],
        ["yw", 0.5],
      ]),
      sliceOn: true,
    },
    "hopfBloom",
  );
  renderFlame4(
    juliaStrata(),
    null,
    "dusk",
    {
      theta: 0,
      phi: Math.acos(0.96 / Math.hypot(0.96, 4.29)),
      radius: Math.hypot(0.96, 4.29),
      fov: 60,
      rotor: rotorFromPlanes([
        ["xw", -1.05],
        ["zw", 0.35],
      ]),
      sliceOn: true,
    },
    "juliaStrata",
  );
  const lens = pentatopePinwheelLensLocal();
  renderFlame4(
    pentatopePinwheel(),
    lens,
    "aurora",
    {
      theta: Math.atan2(1.15, 1.52),
      phi: Math.acos(1.09 / Math.hypot(1.15, 1.09, 1.52)),
      radius: Math.hypot(1.15, 1.09, 1.52),
      fov: 55,
      rotor: rotorFromPlanes([
        ["xw", 0.6],
        ["yw", 0.5],
      ]),
      sliceOn: true,
    },
    "pentatopePinwheel",
  );
});

/** The pinwheel's lens, restated from `presets.ts` (the preset test pins the
 * document's copy; this local copy only has to match it for the render). */
function pentatopePinwheelLensLocal(): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.8, 0.8, 0.8],
    w: { rotation: { xw: 0.25 } },
    variations: [{ type: "julian", weight: 1, julianPower: 3, julianDist: 1 }],
  };
}

it("records hyperkifs' bounds and routing (no CPU panel — the fold descent is a millisecond per query at this map count, so its picture is a compute-path question; the browser pass covered it)", () => {
  const res = runChaosGame4(
    hyperkifs().map(toTransform4),
    20000,
    mulberry32(7),
  );
  const b = res.bounds;
  console.log(
    `hyperkifs: x[${b.minX.toFixed(2)},${b.maxX.toFixed(2)}] ` +
      `y[${b.minY.toFixed(2)},${b.maxY.toFixed(2)}] ` +
      `z[${b.minZ.toFixed(2)},${b.maxZ.toFixed(2)}] ` +
      `w[${b.minW.toFixed(2)},${b.maxW.toFixed(2)}]`,
  );
  const de4 = buildSurfaceDE4(hyperkifs(), null, { order: 1, plane: "xz" }, {});
  console.log(
    `hyperkifs: eligible, stepScale ${de4.stepScale}, maxDepth ${de4.maxDepth}, visR ${de4.visibleBoundingRadius.toFixed(3)}`,
  );
  void pentatope;
});

it("renders the escape pair beside its controls", () => {
  const rInv = rotorInv(SURFACE_ROTOR);
  const lift = lift4(rInv, 0);
  // The membership cloud the extent column walks — the same uniform
  // radius-4 draw `probeEscapeFill4` uses, at the sheet's budget.
  const rng = mulberry32(0x4d_c10d);
  const N = 65536;
  const cloud: FractalVec3[] = [];
  for (let i = 0; i < N; i++) {
    const u = Math.cbrt(rng()) * 4;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    cloud.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
  }
  for (const [name, build] of [
    [
      "flat-chain (control)",
      () => turnedShells().map((t) => ({ ...t, w: undefined })),
    ],
    ["turnedShells", turnedShells],
    ["brickRosette", brickRosette],
    ["mandelboxBrick (control)", mandelboxBrick],
  ] as const) {
    const esc = buildEscapeDE4(build());
    const fill = probeEscapeFill4(esc, 8192);
    let members = 0;
    const ext: [number, number, number] = [0, 0, 0];
    for (const p of cloud) {
      if (escapeSetContains4(esc, [p[0], p[1], p[2], 0])) {
        members++;
        ext[0] = Math.max(ext[0], Math.abs(p[0]));
        ext[1] = Math.max(ext[1], Math.abs(p[1]));
        ext[2] = Math.max(ext[2], Math.abs(p[2]));
      }
    }
    renderSurface4(
      (p) => estimateEscapeDistance4(esc, lift(p)),
      4,
      0.35,
      name.replace(/[^a-z-]+/gi, "-").replace(/^-|-$/g, ""),
    );
    console.log(
      `${name}: ball4 fill ${(100 * fill).toFixed(3)}%  ` +
        `slice members ${members}/${N}  ` +
        `extent ${ext.map((v) => v.toFixed(2)).join("/")}`,
    );
  }
});

it("measures the brick's wedge orders", () => {
  const rng = mulberry32(0x4d_c10d);
  const N = 65536;
  const pts: FractalVec3[] = [];
  for (let i = 0; i < N; i++) {
    const u = Math.cbrt(rng()) * 4;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    pts.push([u * st * Math.cos(ph), u * st * Math.sin(ph), u * ct]);
  }
  const reference = buildEscapeDE4(mandelboxBrick());
  const ref = pts.map((p) =>
    escapeSetContains4(reference, [p[0], p[1], p[2], 0]),
  );
  for (const order of [2, 3, 4]) {
    const de = buildEscapeDE4(brickRosette(), null, {
      order,
      plane: "xz",
    });
    let moved = 0;
    for (const [i, p] of pts.entries()) {
      if (escapeSetContains4(de, [p[0], p[1], p[2], 0]) !== ref[i]) moved++;
    }
    console.log(`order ${order}: ${moved}/${N} points changed side`);
  }
});

it("bounds hyperkifs across all four axes", () => {
  const res = runChaosGame4(
    hyperkifs().map(toTransform4),
    20000,
    mulberry32(7),
  );
  const b = res.bounds;
  console.log(
    `hyperkifs: x[${b.minX.toFixed(2)},${b.maxX.toFixed(2)}] ` +
      `y[${b.minY.toFixed(2)},${b.maxY.toFixed(2)}] ` +
      `z[${b.minZ.toFixed(2)},${b.maxZ.toFixed(2)}] ` +
      `w[${b.minW.toFixed(2)},${b.maxW.toFixed(2)}]`,
  );
  void pentatope;
});
