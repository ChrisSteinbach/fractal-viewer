import type { Rng } from "./rng";
import type { Transform } from "./types";

const HALF = 0.5;

/** The four-map system the viewer starts with. */
export function defaultTransforms(): Transform[] {
  return [
    {
      id: 0,
      position: [0.5, 0.5, 0.5],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [-0.5, 0.5, -0.5],
      rotation: [0, Math.PI / 4, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 2,
      position: [0.5, -0.5, -0.5],
      rotation: [0, 0, Math.PI / 4],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 3,
      position: [-0.5, -0.5, 0.5],
      rotation: [Math.PI / 4, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];
}

/** Four corner maps whose attractor is a Sierpinski tetrahedron. */
export function sierpinskiTetrahedron(): Transform[] {
  return [
    {
      id: 0,
      position: [0, 0.8, 0],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      id: 1,
      position: [0.75, -0.4, 0],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      id: 2,
      position: [-0.375, -0.4, 0.65],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
    {
      id: 3,
      position: [-0.375, -0.4, -0.65],
      rotation: [0, 0, 0],
      scale: [HALF, HALF, HALF],
    },
  ];
}

/** The 20 edge/corner sub-cubes of a Menger sponge (face/centre cells removed). */
export function mengerSponge(): Transform[] {
  const s = 1 / 3;
  const transforms: Transform[] = [];
  let id = 0;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const zeros = (x === 0 ? 1 : 0) + (y === 0 ? 1 : 0) + (z === 0 ? 1 : 0);
        if (zeros >= 2) continue;
        transforms.push({
          id: id++,
          position: [x * 0.5, y * 0.5, z * 0.5],
          rotation: [0, 0, 0],
          scale: [s, s, s],
        });
      }
    }
  }
  return transforms;
}

/** Six maps arranged on a rising, twisting spiral. */
export function spiral(): Transform[] {
  const transforms: Transform[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    transforms.push({
      id: i,
      position: [Math.cos(angle) * 0.4, i * 0.15 - 0.3, Math.sin(angle) * 0.4],
      rotation: [0, angle * 0.5, 0],
      scale: [0.4, 0.4, 0.4],
    });
  }
  return transforms;
}

/** Lowest unused id in a transform list (max existing id + 1, or 0 if empty). */
export function nextId(transforms: Transform[]): number {
  return transforms.reduce((max, t) => Math.max(max, t.id), -1) + 1;
}

/**
 * Append a new transform on a widening spiral, mirroring the viewer's "+ Add"
 * button. Returns a new array — the input is not mutated. Vertical jitter uses
 * the injected RNG so tests can make it deterministic.
 */
export function appendTransform(
  transforms: Transform[],
  rng: Rng = Math.random,
): Transform[] {
  const angle = transforms.length * 2.4;
  const added: Transform = {
    id: nextId(transforms),
    position: [
      Math.cos(angle) * 0.6,
      (rng() - 0.5) * 0.6,
      Math.sin(angle) * 0.6,
    ],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  };
  return [...transforms, added];
}
