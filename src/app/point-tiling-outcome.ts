import type { PointTilingStatus } from "../fractal/point-tiling";

/** Request-associated result metadata for a document which authored space
 * tiling. An absent value means the request authored no tiling block at all;
 * refused and active outcomes stay distinct so a legal empty carrier can
 * never be mistaken for an ordinary untiled fallback. */
export type PointTilingOutcome =
  | {
      availability: "refused";
      note: string;
    }
  | {
      availability: "active";
      kind: "finite" | "lattice";
      fill: PointTilingStatus;
      requested: number;
      attempts: number;
      accepted: number;
      candidateTests: number;
    };

/** Compact pane readout. Ordinary Points keeps its historical `N pts` text;
 * an active tiled request additionally exposes the authored output budget and
 * the terminal fill verdict. */
export function pointCountLabel(
  count: number,
  outcome?: PointTilingOutcome,
): string {
  if (!outcome || outcome.availability === "refused") {
    return `${count.toLocaleString()} pts`;
  }
  return `${count.toLocaleString()} / ${outcome.requested.toLocaleString()} pts · ${outcome.fill}`;
}
