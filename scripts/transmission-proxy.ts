/**
 * Explicit finite optical solids for the transmission comparison, never an
 * interpretation of an arbitrary Surface DE. The Menger replaces the infinite
 * attractor by 400 closed cubes; the native Tesseract replaces it by 256 closed
 * hypercubes. Those cells fill the detail below two construction levels.
 *
 * In 4D, intersect the posed union with the displayed w slice FIRST. Slab
 * intersection of that displayed ray with all four box inequalities gives
 * real entry/exit intervals of the resulting closed 3D object. No DE sign or
 * absolute value supplies membership or an interior stride here.
 */
import { mengerSponge, tesseract } from "../src/fractal/presets";
import type { Vec3 } from "./de-preview";

export interface OpticalBox {
  center: number[];
  half: number;
}

export interface OpticalInterval {
  enter: number;
  exit: number;
}

export interface FiniteOpticalSolid {
  name: string;
  dimension: 3 | 4;
  boxes: OpticalBox[];
  /** Full unsliced radius: changing pose never renormalizes the material. */
  radius: number;
  angle: number;
  slice: number;
  query(p: Vec3): number[];
  contains(p: Vec3): boolean;
  /** Box SDF union; in a 4D slice it is a bound, not exact in-slice distance. */
  distance(p: Vec3): number;
  intervals(origin: Vec3, direction: Vec3): OpticalInterval[];
}

/** Exact ray intervals for a finite union of equally oriented closed boxes. */
export function boxUnionIntervals(
  boxes: OpticalBox[],
  origin: number[],
  direction: number[],
): OpticalInterval[] {
  const intervals: OpticalInterval[] = [];
  for (const box of boxes) {
    let enter = 0;
    let exit = Infinity;
    for (let axis = 0; axis < origin.length; axis++) {
      const p = origin[axis] - box.center[axis];
      const d = direction[axis];
      if (d === 0) {
        if (Math.abs(p) > box.half) {
          exit = -1;
          break;
        }
      } else {
        const a = (-box.half - p) / d;
        const b = (box.half - p) / d;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (exit > enter) intervals.push({ enter, exit });
  }
  intervals.sort((a, b) => a.enter - b.enter || a.exit - b.exit);
  const union: OpticalInterval[] = [];
  for (const interval of intervals) {
    const last = union[union.length - 1];
    // Only touching/overlapping intervals merge. There is deliberately no
    // optical epsilon here: a positive gap, however thin, remains a real gap.
    if (last && interval.enter <= last.exit)
      last.exit = Math.max(last.exit, interval.exit);
    else union.push({ ...interval });
  }
  return union;
}

export function finiteOpticalSolid(
  dimension: 3 | 4,
  depth = 2,
  angle = dimension === 4 ? 0.35 : 0,
  slice = dimension === 4 ? 0.2 : 0,
): FiniteOpticalSolid {
  if (!Number.isInteger(depth) || depth < 0 || depth > 2)
    throw new Error("Optical comparison is bounded to construction depths 0–2");
  if (![angle, slice].every(Number.isFinite))
    throw new Error("Optical pose must be finite");
  const maps = dimension === 3 ? mengerSponge() : tesseract();
  const rootHalf = dimension === 3 ? 0.75 : 0.65;
  let boxes: OpticalBox[] = [
    { center: Array<number>(dimension).fill(0), half: rootHalf },
  ];
  for (let level = 0; level < depth; level++) {
    boxes = maps.flatMap((map) =>
      boxes.map((box) => ({
        center: box.center.map(
          (v, axis) =>
            v / 3 + (axis === 3 ? (map.w?.position ?? 0) : map.position[axis]),
        ),
        half: box.half / 3,
      })),
    );
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const query = (p: Vec3): number[] =>
    dimension === 3
      ? [...p]
      : [c * p[0] - s * slice, p[1], p[2], s * p[0] + c * slice];
  return {
    name:
      dimension === 3
        ? `FINITE MENGER L${depth}`
        : `FINITE TESSERACT L${depth}`,
    dimension,
    boxes,
    radius: rootHalf * Math.sqrt(dimension),
    angle,
    slice,
    query,
    contains(p) {
      const q = query(p);
      return boxes.some((box) =>
        q.every((v, axis) => Math.abs(v - box.center[axis]) <= box.half),
      );
    },
    distance(p) {
      const q = query(p);
      let distance = Infinity;
      for (const box of boxes) {
        let outsideSquared = 0;
        let inside = -Infinity;
        for (let axis = 0; axis < dimension; axis++) {
          const gap = Math.abs(q[axis] - box.center[axis]) - box.half;
          outsideSquared += Math.max(0, gap) ** 2;
          inside = Math.max(inside, gap);
        }
        distance = Math.min(
          distance,
          Math.sqrt(outsideSquared) + Math.min(0, inside),
        );
      }
      return distance;
    },
    intervals(origin, direction) {
      const q = query(origin);
      const d =
        dimension === 3
          ? [...direction]
          : [c * direction[0], direction[1], direction[2], s * direction[0]];
      return boxUnionIntervals(boxes, q, d);
    },
  };
}
