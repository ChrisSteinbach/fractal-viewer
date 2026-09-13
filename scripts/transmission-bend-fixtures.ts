/** Shared exact scenes and optics for the diagnostic and readable bend reviews. */
import type { Vec3 } from "./de-preview";
import type {
  BendFixture,
  BendMaterial,
  BendOptions,
} from "./transmission-bend-study";
import { fixtures } from "./transmission-study";

export const BEND_REFERENCE_OPTIONS: BendOptions = {
  transmit: 0.9,
  ior: 1.45,
  slabFraction: 0.08,
  maxOffsetFraction: 0.08,
  opticalNormalFraction: 0.04,
  maxLayers: 128,
  chunkSteps: 1200,
  maxSamples: 4096,
  residualTolerance: 0,
};

export interface Surface {
  label: string;
  color: Vec3;
  distance: (p: Vec3) => number;
  opaque?: boolean;
}

export const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, i) => sum + value * b[i], 0);
export const normalized = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length) as Vec3;
};
const sphere = (center: Vec3, radius: number) => (p: Vec3) =>
  Math.abs(Math.hypot(...p.map((v, i) => v - center[i])) - radius);

export function fromSurfaces(
  name: string,
  surfaces: Surface[],
  radius = 1.25,
): BendFixture {
  const nearest = (p: Vec3): [Surface, number] => {
    let selected = surfaces[0];
    let distance = selected.distance(p);
    for (const candidate of surfaces.slice(1)) {
      const d = candidate.distance(p);
      if (d < distance) [selected, distance] = [candidate, d];
    }
    return [selected, distance];
  };
  return {
    name,
    scene: {
      de: (p) => nearest(p)[1],
      boundingRadius: radius,
      stepScale: 1,
      eye: [0, 0, 3],
      target: [0, 0, 0],
      zoom: 0.3,
    },
    material(p): BendMaterial {
      const selected = nearest(p)[0];
      return {
        label: selected.label,
        color: selected.color,
        opaque: selected.opaque,
      };
    },
  };
}

export function analyticFixture(rear: boolean): BendFixture {
  const surfaces: Surface[] = [
    {
      label: "front",
      color: [0.1, 0.78, 0.96],
      distance: sphere([-0.08, 0, 0.42], 0.48),
    },
  ];
  if (rear)
    surfaces.push({
      label: "rear",
      color: [1, 0.12, 0.035],
      distance: sphere([0.26, 0, -0.42], 0.17),
      opaque: true,
    });
  return fromSurfaces(`ANALYTIC REAR ${rear}`, surfaces);
}

export function native4HypersphereFixture(rear: boolean): BendFixture {
  const angle = 0.37;
  const w0 = 0.23;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const sliceNormal = [-s, 0, 0, c] as const;
  const q4 = (p: Vec3): [number, number, number, number] => [
    c * p[0] - s * w0,
    p[1],
    p[2],
    s * p[0] + c * w0,
  ];
  const hypersphere = (center3: Vec3, radius3: number, offset4: number) => {
    const displayedCenter = q4(center3);
    const center4 = displayedCenter.map(
      (value, axis) => value + offset4 * sliceNormal[axis],
    );
    const radius4 = Math.hypot(radius3, offset4);
    return (p: Vec3) =>
      Math.abs(
        Math.hypot(...q4(p).map((value, axis) => value - center4[axis])) -
          radius4,
      );
  };
  const surfaces: Surface[] = [
    {
      label: "front",
      color: [0.1, 0.78, 0.96],
      distance: hypersphere([-0.08, 0, 0.42], 0.48, 0.2),
    },
  ];
  if (rear)
    surfaces.push({
      label: "rear",
      color: [1, 0.12, 0.035],
      distance: hypersphere([0.26, 0, -0.42], 0.17, 0.05),
      opaque: true,
    });
  return fromSurfaces(`POSED 4D HYPERSPHERE REAR ${rear}`, surfaces);
}

export function proceduralFloor(R: number) {
  const floorY = -1.05 * R;
  return (origin: Vec3, rd: Vec3): Vec3 => {
    if (rd[1] < -1e-8) {
      const t = (floorY - origin[1]) / rd[1];
      if (t > 0) {
        const x = origin[0] + rd[0] * t;
        const z = origin[2] + rd[2] * t;
        const checker =
          (Math.floor(x / (0.18 * R)) + Math.floor(z / (0.18 * R))) & 1;
        return checker ? [0.7, 0.17, 0.05] : [0.035, 0.32, 0.7];
      }
    }
    return [0.025, 0.035, 0.055];
  };
}

export function fractalFixture(
  name: "MENGER 3D" | "MANDELBOX 4D",
  pose: Parameters<typeof fixtures>[0],
): BendFixture {
  const source = fixtures(pose).find((fixture) => fixture.name === name)!;
  return {
    name,
    scene: source.scene,
    material: (p) => ({ label: "fractal", color: source.color(p) }),
  };
}

export type BendVisualKey = "menger3" | "native4" | "analytic3" | "analytic4";
export type BendVisualPose = NonNullable<Parameters<typeof fixtures>[0]>;
export const BEND_STILL_POSES = {
  menger: { angle: 0.2, eyeOffset: [1.4, 0.9, 1.7] as Vec3, zoom: 0.43 },
  native4: {
    angle: 0.35,
    w0: 0.3,
    eyeOffset: [0.55, 0.35, 2.2] as Vec3,
    zoom: 0.22,
  },
};
export const BEND_MOTION_GROUPS: {
  key: string;
  fixtureName: "MENGER 3D" | "MANDELBOX 4D";
  poses: BendVisualPose[];
  isolated: string;
}[] = [
  {
    key: "menger-camera",
    fixtureName: "MENGER 3D",
    isolated: "camera x",
    poses: [1.32, 1.4, 1.48].map((x) => ({
      eyeOffset: [x, 0.9, 1.7] as Vec3,
      zoom: 0.43,
    })),
  },
  {
    key: "native4-rotor",
    fixtureName: "MANDELBOX 4D",
    isolated: "XW rotor angle",
    poses: [0.31, 0.35, 0.39].map((angle) => ({
      angle,
      w0: 0.3,
      eyeOffset: [0.55, 0.35, 2.2] as Vec3,
      zoom: 0.22,
    })),
  },
  {
    key: "native4-slice",
    fixtureName: "MANDELBOX 4D",
    isolated: "slice w0",
    poses: [0.26, 0.3, 0.34].map((w0) => ({
      angle: 0.35,
      w0,
      eyeOffset: [0.55, 0.35, 2.2] as Vec3,
      zoom: 0.22,
    })),
  },
];
export function createBendVisualFixture(
  key: BendVisualKey,
  pose?: BendVisualPose,
  rear = true,
): BendFixture {
  switch (key) {
    case "menger3":
      return fractalFixture("MENGER 3D", pose ?? BEND_STILL_POSES.menger);
    case "native4":
      return fractalFixture("MANDELBOX 4D", pose ?? BEND_STILL_POSES.native4);
    case "analytic3":
      return analyticFixture(rear);
    case "analytic4":
      return native4HypersphereFixture(rear);
  }
}
