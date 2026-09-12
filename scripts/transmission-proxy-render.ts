/** Shared-renderer visual comparison for the explicitly finite optical solids. */
import {
  finishShadeTs,
  resolveSurfaceFinish,
} from "../src/fractal/surface-finish";
import { renderPreview } from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";
import type { FiniteOpticalSolid, OpticalInterval } from "./transmission-proxy";

export type RearRadiance = (origin: Vec3, direction: Vec3) => Vec3;
const SKY: Vec3 = [0.006, 0.012, 0.025];
const FINISH = resolveSurfaceFinish({
  specular: 1,
  shininess: 128,
  reflect: 0.5,
});

/** A real plane below the ENTIRE ball. For a ray that visits the ball it can
 * only be behind it, so this terminal has no hidden front-occlusion shortcut.
 * It is deliberately unshadowed, with a constant lighting factor. */
export function proceduralRear(radius: number, floor: boolean): RearRadiance {
  return (origin, direction) => {
    if (!floor || direction[1] >= 0) return SKY;
    const t = (-1.05 * radius - origin[1]) / direction[1];
    if (t <= 0) return SKY;
    const x = (origin[0] + t * direction[0]) / (0.25 * radius);
    const z = (origin[2] + t * direction[2]) / (0.25 * radius);
    const light = (((Math.floor(x) + Math.floor(z)) % 2) + 2) % 2 === 0;
    return light ? [0.6, 0.48, 0.3] : [0.025, 0.035, 0.06];
  };
}

export interface FiniteTransmissionPanel {
  stats: PanelStats;
  maximumIntervals: number;
  unresolved: number;
  normalQueries: number;
  /** Every box is intersected once per primary ray, independent of pixels hit. */
  boxIntersections: number;
  meanPathLengthOverRadius: number;
}

/**
 * Analytic intervals feed de-preview's marchInterval; every hit and every
 * camera ray still goes through the shared renderer. One finish contribution
 * occurs at each union interval's entry. Beer attenuation uses its ACTUAL
 * path length, not scan iterations. The ray travels straight: this comparison
 * does not pretend to be refracted glass or a general signed Surface scene.
 */
export function renderFiniteTransmission(
  solid: FiniteOpticalSolid,
  scene: PreviewScene,
  color: (p: Vec3) => Vec3,
  size: number,
  transmit = 0.9,
  absorption = 0.8,
  rear: RearRadiance = proceduralRear(solid.radius, true),
  maxLayers = 32,
): FiniteTransmissionPanel {
  interface State {
    intervals: OpticalInterval[];
    next: number;
    weight: number;
    color: Vec3;
    done: boolean;
  }
  const states = new Map<string, State>();
  let current: State;
  let maximumIntervals = 0;
  let normalQueries = 0;
  let boxIntersections = 0;
  let pathSum = 0;
  let covered = 0;
  let firstHits = 0;
  let totalMs = 0;
  let totalEvals = 0;
  let stats: PanelStats | undefined;
  const R = solid.radius;
  const normal = (p: Vec3): Vec3 => {
    const h = 0.02 * R;
    const n = [0, 1, 2].map((axis) => {
      const a: Vec3 = [...p];
      const b: Vec3 = [...p];
      a[axis] += h;
      b[axis] -= h;
      normalQueries += 2;
      return solid.distance(a) - solid.distance(b);
    }) as Vec3;
    const magnitude = Math.hypot(...n);
    return magnitude > 1e-15
      ? (n.map((v) => v / magnitude) as Vec3)
      : [0, 0, 1];
  };
  for (let layer = 0; layer < maxLayers; layer++) {
    stats = renderPreview(
      {
        ...scene,
        de: (p) => solid.distance(p),
        stepScale: 1,
        minimumStepFraction: 0,
        maxSteps: 1,
        ao: false,
        shadow: false,
        fog: false,
        background: { top: SKY, bottom: SKY },
        marchInterval(origin, direction, pixel) {
          const key = `${pixel.px},${pixel.py}`;
          if (layer === 0) {
            const intervals = solid.intervals(origin, direction);
            boxIntersections += solid.boxes.length;
            maximumIntervals = Math.max(maximumIntervals, intervals.length);
            if (intervals.length) {
              covered++;
              pathSum += intervals.reduce(
                (sum, i) => sum + i.exit - i.enter,
                0,
              );
            }
            current = {
              intervals,
              next: 0,
              weight: 1,
              color: [0, 0, 0],
              done: false,
            };
            states.set(key, current);
          } else current = states.get(key)!;
          const interval = current.intervals[current.next];
          return !current.done && interval
            ? [interval.enter, interval.exit]
            : null;
        },
        march() {
          // The exact slab oracle, not a tolerance on the SDF, located this hit.
          return { d: 0, stride: 0 };
        },
        shadeLinear(hit) {
          let n = normal(hit.p);
          let facing = -n.reduce((sum, v, axis) => sum + v * hit.rd[axis], 0);
          if (facing < 0) {
            n = n.map((v) => -v) as Vec3;
            facing = -facing;
          }
          const local = finishShadeTs(
            color(hit.p),
            n,
            hit.rd,
            1,
            1,
            hit.bg,
            FINISH,
            {
              lightDir: hit.light,
              ambient: 0.25,
              envStrength: 0,
              bgTop: [0.1, 0.14, 0.2],
              bgBottom: [0.025, 0.035, 0.055],
            },
          );
          const fresnel = 0.04 + 0.96 * (1 - Math.min(1, facing)) ** 5;
          const tau = transmit * (1 - fresnel);
          const interval = current.intervals[current.next++];
          for (let c = 0; c < 3; c++)
            current.color[c] +=
              current.weight * (1 - tau) * Math.max(0, local[c]) ** 2.2;
          current.weight *=
            tau *
            Math.exp((-absorption * (interval.exit - interval.enter)) / R);
          if (current.weight === 0) current.done = true;
          return current.color;
        },
        rayLinear(ray) {
          if (!current.done && current.next === current.intervals.length) {
            const background = rear(ray.origin, ray.rd);
            for (let c = 0; c < 3; c++)
              current.color[c] += current.weight * background[c];
            current.done = true;
          }
          return current.color;
        },
      },
      size,
    );
    if (layer === 0) firstHits = stats.hits;
    totalMs += stats.ms;
    totalEvals += stats.evals;
    if ([...states.values()].every((state) => state.done)) break;
  }
  const unresolved = [...states.values()].filter((state) => !state.done).length;
  return {
    stats: {
      ...stats!,
      hits: firstHits,
      exhausted: unresolved,
      ms: totalMs,
      evals: totalEvals,
    },
    maximumIntervals,
    unresolved,
    normalQueries,
    boxIntersections,
    meanPathLengthOverRadius: pathSum / Math.max(1, covered) / R,
  };
}
