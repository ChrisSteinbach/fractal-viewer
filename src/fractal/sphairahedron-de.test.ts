import {
  SPHAIRAHEDRON_FOLD_CAP,
  SPHAIRAHEDRON_FOLD_CAPPED,
  SPHAIRAHEDRON_FOLD_DOMAIN,
  SPHAIRAHEDRON_FOLD_POLE,
  SPHAIRAHEDRON_FUDGE,
  foldSphairahedron,
  makeSphairahedronScratch,
  resolveSphairahedron,
  sphairahedronContains,
  sphairahedronTileSDF,
} from "./sphairahedron";
import {
  buildSphairahedronDE,
  estimateSphairahedronDistance,
  makeSphairahedronHit,
  sphairahedronContains as deContains,
  sphairahedronHitInfo,
} from "./sphairahedron-de";
import {
  buildSphairahedronDE4,
  estimateSphairahedronDistance4,
  sphairahedronHitInfo4,
} from "./sphairahedron-de-4d";
import type { Vec3, Vec4 } from "./types";

function resolved(authored: Parameters<typeof resolveSphairahedron>[0]) {
  const r = resolveSphairahedron(authored);
  if (!r.ok) throw new Error(`refused: ${r.reasons.join("; ")}`);
  return r;
}

/** The study's anchor methodology: march to a real sign bracket, then 48
 * bisection steps — the surviving zero is the estimator's zero set, not
 * the marching bias. Returns the hit point, or null when the ray never
 * crosses. */
function bisect3(
  de: ReturnType<typeof buildSphairahedronDE>,
  eye: Vec3,
  dir: Vec3,
): Vec3 | null {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const d: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const at = (t: number): Vec3 => [
    eye[0] + d[0] * t,
    eye[1] + d[1] * t,
    eye[2] + d[2] * t,
  ];
  let tPrev = 0;
  let vPrev = estimateSphairahedronDistance(de, at(tPrev));
  if (vPrev <= 0) return null;
  for (let i = 0; i < 400; i++) {
    const t = tPrev + Math.max(vPrev * 0.5, 1e-4);
    const v = estimateSphairahedronDistance(de, at(t));
    if (v <= 0) {
      let lo = tPrev;
      let hi = t;
      for (let k = 0; k < 48; k++) {
        const mid = (lo + hi) / 2;
        if (estimateSphairahedronDistance(de, at(mid)) > 0) lo = mid;
        else hi = mid;
      }
      return at(hi);
    }
    tPrev = t;
    vPrev = v;
  }
  return null;
}

function bisect4(
  de: ReturnType<typeof buildSphairahedronDE4>,
  eye: Vec4,
  dir: Vec4,
  w0: number,
): [number, number, number] | null {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const d: Vec4 = [dir[0] / l, dir[1] / l, dir[2] / l, 0];
  const at = (t: number): Vec4 => [
    eye[0] + d[0] * t,
    eye[1] + d[1] * t,
    eye[2] + d[2] * t,
    w0,
  ];
  let tPrev = 0;
  let vPrev = estimateSphairahedronDistance4(de, at(tPrev));
  if (vPrev <= 0) return null;
  for (let i = 0; i < 400; i++) {
    const t = tPrev + Math.max(vPrev * 0.5, 1e-4);
    const v = estimateSphairahedronDistance4(de, at(t));
    if (v <= 0) {
      let lo = tPrev;
      let hi = t;
      for (let k = 0; k < 48; k++) {
        const mid = (lo + hi) / 2;
        if (estimateSphairahedronDistance4(de, at(mid)) > 0) lo = mid;
        else hi = mid;
      }
      const hit = at(hi);
      return [hit[0], hit[1], hit[2]];
    }
    tPrev = t;
    vPrev = v;
  }
  return null;
}

function stats(errs: number[]): { rms: number; max: number; n: number } {
  const ok = errs.filter((e) => Number.isFinite(e));
  const rms = Math.sqrt(ok.reduce((s, x) => s + x * x, 0) / ok.length);
  return { rms, max: Math.max(...ok), n: ok.length };
}

/** The analytic image of the tetra's invariant plane under `J`: a sphere
 * through J's centre with centre `J.c − n·R²/(2d)` and radius `R²/(2|d|)`,
 * `d = n·J.c − h` (module doc of `sphairahedron.ts`). */
function analyticSphere(
  construction: ReturnType<typeof resolved>["construction"],
): { c: number[]; r: number } {
  const j = construction.inversion;
  if (!j) throw new Error("the analytic sphere needs a finite construction");
  const n = construction.divide.n;
  const d = n.reduce((s, v, i) => s + v * j.c[i], 0) - construction.divide.h;
  const k = (j.r * j.r) / (2 * d);
  return { c: j.c.map((v, i) => v - k * n[i]), r: Math.abs(k) };
}

describe("sphairahedron DE anchors (the zero set against the analytic limit sets)", () => {
  it("the infinite tetra's limit set is the plane y = 0", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    const errs: number[] = [];
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const hit = bisect3(
          de,
          [0, 2.5, 0],
          [-0.6 + a * 0.24, -1, -0.6 + b * 0.24],
        );
        if (hit) errs.push(Math.abs(hit[1]));
      }
    }
    const s = stats(errs);
    expect(s.n).toBe(36);
    expect(s.rms).toBeLessThanOrEqual(1e-5);
    expect(s.max).toBeLessThanOrEqual(1e-4);
  });

  it("the finite tetra's limit set is the analytic sphere, exactly on its boundary", () => {
    const { construction } = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    });
    const de = buildSphairahedronDE(construction);
    const { c, r } = analyticSphere(construction);
    const j = construction.inversion as { c: readonly number[]; r: number };
    const errs: number[] = [];
    let rays = 0;
    // Aim every ray at a deterministic point on the sphere's lower cap,
    // EXCLUDING rays that pass near J's centre: the sphere passes through
    // the inversion centre by construction, and the estimate degenerates
    // in its neighbourhood (the pole regime) — the anchor measures the
    // zero set on the clean carrier.
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const u = -0.6 + a * 0.24;
        const v = -0.6 + b * 0.24;
        const l = Math.hypot(u, 1, v);
        const target: Vec3 = [
          c[0] + (r * u) / l,
          c[1] - r / l,
          c[2] + (r * v) / l,
        ];
        const dir: Vec3 = [target[0] - 0.9, target[1] - 3.4, target[2] - 0.6];
        const jl = Math.hypot(dir[0], dir[1], dir[2]);
        const jc: Vec3 = [j.c[0] - 0.9, j.c[1] - 3.4, j.c[2] - 0.6];
        const along = (jc[0] * dir[0] + jc[1] * dir[1] + jc[2] * dir[2]) / jl;
        const close = Math.sqrt(
          Math.max(0, jc[0] ** 2 + jc[1] ** 2 + jc[2] ** 2 - along * along),
        );
        if (close < 0.08) continue;
        rays++;
        const hit = bisect3(de, [0.9, 3.4, 0.6], dir);
        if (hit)
          errs.push(
            Math.abs(
              Math.hypot(hit[0] - c[0], hit[1] - c[1], hit[2] - c[2]) - r,
            ),
          );
      }
    }
    const s = stats(errs);
    expect(rays).toBe(36);
    expect(s.n).toBe(36);
    expect(s.rms).toBeLessThanOrEqual(1e-8);
    expect(s.max).toBeLessThanOrEqual(1e-7);
  });

  it("the flat cube's limit set is the plane y = 0", () => {
    const { construction } = resolved({ family: "cube1", za: 0, zb: 0 });
    const de = buildSphairahedronDE(construction);
    const errs: number[] = [];
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const hit = bisect3(
          de,
          [0, 2.5, 0],
          [-0.6 + a * 0.24, -1, -0.6 + b * 0.24],
        );
        if (hit) errs.push(Math.abs(hit[1]));
      }
    }
    const s = stats(errs);
    expect(s.n).toBe(36);
    expect(s.rms).toBeLessThanOrEqual(1e-5);
    expect(s.max).toBeLessThanOrEqual(1e-4);
  });

  it("the 4D tetra lift anchors on the analytic 3-sphere's slices", () => {
    const { construction } = resolved({
      family: "tetra4",
      inversion: { cx: 0.5, cy: 3, cz: 0, cw: 0, r: 1.3 },
    });
    const de = buildSphairahedronDE4(construction);
    const { c, r } = analyticSphere(construction);
    for (const w0 of [0, 0.15]) {
      const rs = Math.sqrt(r * r - w0 * w0);
      const errs: number[] = [];
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) {
          const u = -0.5 + a * 0.25;
          const v = -0.5 + b * 0.25;
          const l = Math.hypot(u, 1, v);
          const tx = c[0] + (rs * u) / l;
          const ty = c[1] - rs / l;
          const tz = c[2] + (rs * v) / l;
          const hit = bisect4(
            de,
            [0.9, 3.4, 0.6, w0],
            [tx - 0.9, ty - 3.4, tz - 0.6, 0],
            w0,
          );
          if (hit)
            errs.push(
              Math.abs(
                Math.hypot(hit[0] - c[0], hit[1] - c[1], hit[2] - c[2]) - rs,
              ),
            );
        }
      }
      const s = stats(errs);
      expect(s.n).toBe(25);
      if (w0 === 0) {
        expect(s.rms).toBeLessThanOrEqual(1e-6);
        expect(s.max).toBeLessThanOrEqual(1e-5);
      } else {
        // The off-slice case measured at machine precision (the study's
        // 6.3e-16): the slice of the analytic 3-sphere, recovered exactly.
        expect(s.rms).toBeLessThanOrEqual(1e-12);
        expect(s.max).toBeLessThanOrEqual(1e-11);
      }
    }
  });
});

describe("sphairahedron DE fold statuses", () => {
  it("returns the pole contract at a face sphere's centre", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    const hit = sphairahedronHitInfo(de, [0, 0, 0]);
    expect(hit.status).toBe(SPHAIRAHEDRON_FOLD_POLE);
    expect(hit.d).toBe(0);
    expect(deContains(de, [0, 0, 0])).toBe(false);
  });

  it("marks capped folds when the pass cap is spent, and membership refuses them", () => {
    const { construction } = resolved({ family: "tetra333" });
    // A natural capped query: inside the excavation ball above the divide,
    // where the fold bounces between the inversion and the walls.
    const de = buildSphairahedronDE(construction);
    const hit = sphairahedronHitInfo(de, [0, 0, 0.5]);
    expect(hit.status).toBe(SPHAIRAHEDRON_FOLD_CAPPED);
    expect(hit.capped).toBe(true);
    expect(hit.moves).toBeGreaterThanOrEqual(construction.foldCap);
    expect(deContains(de, [0, 0, 0.5])).toBe(false);
    // The cap as a numerical guard: with the cap at 1, any query needing
    // two passes reads capped.
    const shallow = buildSphairahedronDE({
      ...construction,
      foldCap: 1,
    });
    const forced = sphairahedronHitInfo(shallow, [0, -0.5, 0]);
    expect(forced.status).toBe(SPHAIRAHEDRON_FOLD_CAPPED);
  });

  it("reports clean domain folds with consistent counters", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    const hit = sphairahedronHitInfo(de, [0, -0.5, 0]);
    expect(hit.status).toBe(SPHAIRAHEDRON_FOLD_DOMAIN);
    expect(hit.capped).toBe(false);
    expect(hit.moves).toBe(hit.inversions + hit.reflections);
    expect(hit.passes).toBeGreaterThan(0);
    expect(hit.d).toBeLessThan(0);
  });
});

describe("sphairahedron DE estimate and membership", () => {
  it("reads negative inside the finite tetra's sphere and positive far away", () => {
    const { construction } = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    });
    const de = buildSphairahedronDE(construction);
    const { c } = analyticSphere(construction);
    const inside: Vec3 = [c[0], c[1], c[2]];
    expect(estimateSphairahedronDistance(de, inside)).toBeLessThan(0);
    expect(deContains(de, inside)).toBe(true);
    const far: Vec3 = [10, 10, 10];
    expect(estimateSphairahedronDistance(de, far)).toBeGreaterThan(0);
    expect(deContains(de, far)).toBe(false);
  });

  it("agrees with the plain-data fold and tile over sampled queries", () => {
    const { construction } = resolved({
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      inversion: { cx: 0.4, cy: 0.4, cz: 0.4, r: 0.5 },
    });
    const de = buildSphairahedronDE(construction);
    const scratch = makeSphairahedronScratch(3, construction.foldCap);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [
        Math.sin(i * 1.7) * 1.3,
        Math.sin(i * 0.91) * 1.5,
        Math.sin(i * 2.3) * 1.1,
      ];
      foldSphairahedron(construction, p, scratch);
      const plain =
        (sphairahedronTileSDF(construction, scratch.x) /
          Math.abs(scratch.lambda)) *
        SPHAIRAHEDRON_FUDGE;
      const flat = estimateSphairahedronDistance(de, p);
      // The two paths share the arithmetic shape but not the expression
      // forms (x**2 vs x*x); agreement is pinned at 1e-12 relative, not
      // bit-exact.
      const scale = Math.max(1, Math.abs(plain));
      expect(Math.abs(plain - flat)).toBeLessThanOrEqual(1e-12 * scale);
      expect(sphairahedronContains(construction, p, scratch)).toBe(
        deContains(de, p),
      );
    }
  });

  it("carries the fudge inside the estimate (the march damps at step scale 1)", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    const scratch = makeSphairahedronScratch(3, construction.foldCap);
    const p: Vec3 = [0, -0.5, 0];
    foldSphairahedron(construction, p, scratch);
    const raw =
      sphairahedronTileSDF(construction, scratch.x) / Math.abs(scratch.lambda);
    expect(estimateSphairahedronDistance(de, p)).toBeCloseTo(
      raw * SPHAIRAHEDRON_FUDGE,
      15,
    );
  });
});

describe("sphairahedron DE hit info", () => {
  it("reports the plain estimate bit-identically", () => {
    const { construction } = resolved({
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      inversion: { cx: 0.4, cy: 0.4, cz: 0.4, r: 0.5 },
    });
    const de = buildSphairahedronDE(construction);
    for (let i = 0; i < 100; i++) {
      const p: Vec3 = [
        Math.sin(i * 2.1) * 1.2,
        Math.sin(i * 1.3) * 1.4,
        Math.sin(i * 0.7) * 1.2,
      ];
      const hit = sphairahedronHitInfo(de, p, makeSphairahedronHit());
      expect(hit.d).toBe(estimateSphairahedronDistance(de, p));
    }
  });

  it("counts the fold moves the colour sources will read", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    const hit = sphairahedronHitInfo(de, [0.3, -0.4, 0.2]);
    expect(hit.moves).toBe(hit.inversions + hit.reflections);
    expect(hit.moves).toBeGreaterThan(0);
  });

  it("attributes the last fold move's face (the per-face color source's key)", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    // Face order: the ball first, then the three walls. A query whose
    // final move is an inversion lands on the ball (face 0); one whose
    // final move is a reflection lands on the wall it reflected across.
    const ballInverted = sphairahedronHitInfo(de, [0.15, -0.2, 0.1]);
    expect(ballInverted.lastFace).toBeGreaterThanOrEqual(0);
    expect(
      ballInverted.lastFace === 0 || de.faceKind[ballInverted.lastFace] === 1,
    ).toBe(true);
    // A no-move query — already inside every face's solid side — carries
    // −1: no face touched, no attribution to invent.
    const inside = sphairahedronHitInfo(de, [0, -1, 0.2]);
    expect(inside.moves).toBe(0);
    expect(inside.lastFace).toBe(-1);
    // Every moved query's attribution names a real face, and re-running
    // the fold is deterministic (the same face both times).
    for (let i = 0; i < 40; i++) {
      const p: Vec3 = [
        Math.sin(i * 2.1) * 2.0,
        Math.sin(i * 1.3) * 2.0,
        Math.sin(i * 0.7) * 2.0,
      ];
      const hit = sphairahedronHitInfo(de, p);
      if (hit.moves === 0) {
        expect(hit.lastFace).toBe(-1);
      } else {
        expect(hit.lastFace).toBeGreaterThanOrEqual(0);
        expect(hit.lastFace).toBeLessThan(de.faceCount);
      }
    }
  });

  it("carries the framing ball the GPU packers transfer (the march sphere)", () => {
    const { construction } = resolved({ family: "tetra333" });
    const de = buildSphairahedronDE(construction);
    expect(de.boundingRadius).toBe(construction.bound.radius);
    expect(de.visibleBoundingRadius).toBe(construction.bound.radius);
    const de4 = buildSphairahedronDE4(
      resolved({ family: "tetra4" }).construction,
    );
    expect(de4.boundingRadius).toBe(
      resolved({ family: "tetra4" }).construction.bound.radius,
    );
  });
});

describe("sphairahedron 4D twin", () => {
  it("is bit-identical to the 3D estimator on the w = 0 slice, infinite and finite", () => {
    const infinite3 = resolved({ family: "tetra333" }).construction;
    const infinite4 = resolved({ family: "tetra4" }).construction;
    const de3 = buildSphairahedronDE(infinite3);
    const de4 = buildSphairahedronDE4(infinite4);
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [
        Math.sin(i * 1.7) * 2.1,
        Math.sin(i * 0.9) * 2.3,
        Math.sin(i * 2.3) * 1.9,
      ];
      expect(estimateSphairahedronDistance4(de4, [p[0], p[1], p[2], 0])).toBe(
        estimateSphairahedronDistance(de3, p),
      );
    }
    const finite3 = resolved({
      family: "tetra333",
      inversion: { cx: 0.5, cy: 3, cz: 0, r: 1.3 },
    }).construction;
    const finite4 = resolved({
      family: "tetra4",
      inversion: { cx: 0.5, cy: 3, cz: 0, cw: 0, r: 1.3 },
    }).construction;
    const fde3 = buildSphairahedronDE(finite3);
    const fde4 = buildSphairahedronDE4(finite4);
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [
        0.5 + Math.sin(i * 1.7) * 1.1,
        2.7183 + Math.sin(i * 0.9) * 1.3,
        Math.sin(i * 2.3) * 1.1,
      ];
      expect(estimateSphairahedronDistance4(fde4, [p[0], p[1], p[2], 0])).toBe(
        estimateSphairahedronDistance(fde3, p),
      );
    }
  });

  it("refuses a 3D construction and the 3D twin refuses a 4D one", () => {
    const c3 = resolved({ family: "tetra333" }).construction;
    const c4 = resolved({ family: "tetra4" }).construction;
    expect(() => buildSphairahedronDE4(c3)).toThrow(/dimension 3 is not 4/);
    expect(() => buildSphairahedronDE(c4)).toThrow(/dimension 4 is not 3/);
  });

  it("reports 4D hit info with the same counter contract", () => {
    const { construction } = resolved({
      family: "tetra4",
      inversion: { cx: 0.5, cy: 3, cz: 0, cw: 0, r: 1.3 },
    });
    const de = buildSphairahedronDE4(construction);
    const hit = sphairahedronHitInfo4(de, [0.5, 2.7183, 0, 0]);
    expect(hit.moves).toBe(hit.inversions + hit.reflections);
    expect(hit.d).toBeLessThan(0);
    expect(hit.status).toBe(SPHAIRAHEDRON_FOLD_DOMAIN);
  });

  it("carries the last-move attribution one dimension up, bit-identical at w = 0", () => {
    const de3 = buildSphairahedronDE(
      resolved({ family: "tetra333" }).construction,
    );
    const de4 = buildSphairahedronDE4(
      resolved({ family: "tetra4" }).construction,
    );
    for (let i = 0; i < 100; i++) {
      const p: Vec3 = [
        Math.sin(i * 1.9) * 1.8,
        Math.sin(i * 1.1) * 1.8,
        Math.sin(i * 2.7) * 1.4,
      ];
      const h3 = sphairahedronHitInfo(de3, p);
      const h4 = sphairahedronHitInfo4(de4, [p[0], p[1], p[2], 0]);
      expect(h4.lastFace).toBe(h3.lastFace);
      expect(h4.moves).toBe(h3.moves);
    }
  });
});

describe("sphairahedron DE table invariants", () => {
  it("flattens the scan order and senses the construction carries", () => {
    const { construction } = resolved({
      family: "cube1",
      za: 0.5,
      zb: 1.0,
      inversion: { cx: 0.4, cy: 0.4, cz: 0.4, r: 0.5 },
    });
    const de = buildSphairahedronDE(construction);
    expect(de.faceCount).toBe(construction.foldFaces.length);
    expect(de.pieceCount).toBe(construction.pieces.length);
    let termTotal = 0;
    for (const piece of construction.pieces) termTotal += piece.terms.length;
    expect(de.termKind.length).toBe(termTotal);
    // Every finite face flattens as a sphere (walls map to spheres).
    for (let i = 0; i < de.faceCount; i++) expect(de.faceKind[i]).toBe(0);
    for (let i = 0; i < de.faceCount; i++) {
      expect(de.faceData[i * 5 + 3]).toBe(
        (construction.foldFaces[i].face as { sphere: { r: number } }).sphere.r,
      );
    }
    expect(construction.foldCap).toBe(SPHAIRAHEDRON_FOLD_CAP);
  });
});
