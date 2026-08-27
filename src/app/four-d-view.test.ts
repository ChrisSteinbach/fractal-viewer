import { FourDView, FourDTween, viewTransition } from "./four-d-view";
import type { FourDPose } from "./four-d-view";
import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";

// prettier-ignore
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function expectMatClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(16);
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v));
}

/** Largest deviation of any entry of `m` from the identity matrix. */
function maxDeviationFromIdentity(m: number[]): number {
  return Math.max(...m.map((v, i) => Math.abs(v - IDENTITY[i])));
}

describe("FourDView", () => {
  it("starts at the documented initial values before any reset", () => {
    const view = new FourDView();

    expect(view.tumbleOn).toBe(true);
    expect(view.tumbleSpeed).toBe(1);
    expect(view.sliceOn).toBe(false);
    expect(view.sliceCenter).toBe(0);
    expect(view.sliceRelColor).toBe(false);
    expectMatClose(view.matrix(), IDENTITY);
  });

  describe("reset", () => {
    it("leaves the rotor at identity and the fields at baseline when automatic motion is on", () => {
      const view = new FourDView();

      view.reset(true);

      expectMatClose(view.matrix(), IDENTITY);
      expect(view.tumbleOn).toBe(true);
      expect(view.tumbleSpeed).toBe(1);
      expect(view.sliceOn).toBe(false);
      expect(view.sliceCenter).toBe(0);
      expect(view.sliceRelColor).toBe(false);
    });

    it("pauses the tumble but seeds a non-identity rotor when automatic motion is off", () => {
      const view = new FourDView();

      view.reset(false);

      expect(view.tumbleOn).toBe(false);
      // A paused projection sitting exactly on the identity view would look
      // indistinguishable from the flat 3D embed, so reset(false) pre-seeds a
      // generic orientation instead of leaving the rotor untouched.
      expect(maxDeviationFromIdentity(view.matrix())).toBeGreaterThan(0.1);
    });

    it("clears prior slice and tumble edits back to baseline", () => {
      const view = new FourDView();
      view.sliceOn = true;
      view.sliceCenter = 5;
      view.sliceRelColor = true;
      view.tumbleOn = false;
      view.tumbleSpeed = 3;

      view.reset(true);

      expect(view.sliceOn).toBe(false);
      expect(view.sliceCenter).toBe(0);
      expect(view.sliceRelColor).toBe(false);
      expect(view.tumbleOn).toBe(true);
      expect(view.tumbleSpeed).toBe(1);
    });

    it("returns a widened slice slab to the zero-thickness cross-section", () => {
      const view = new FourDView();
      view.sliceThickness = 0.3;

      view.reset(true);

      expect(view.sliceThickness).toBe(0);
    });
  });

  describe("tick", () => {
    it("advances the rotor away from identity while the tumble is running", () => {
      const view = new FourDView();
      view.reset(true);

      view.tick(1);

      expect(maxDeviationFromIdentity(view.matrix())).toBeGreaterThan(0.01);
    });

    it("is a no-op while the tumble is paused", () => {
      const view = new FourDView();
      view.reset(true);
      view.tumbleOn = false;

      view.tick(10);

      expectMatClose(view.matrix(), IDENTITY);
    });

    it("rotates further at a higher tumbleSpeed", () => {
      const base = new FourDView();
      base.reset(true);
      base.tick(1);

      const fast = new FourDView();
      fast.reset(true);
      fast.tumbleSpeed = 2;
      fast.tick(1);

      // Same off-diagonal entry (row 0, col 1 — the xy-plane's sine term),
      // compared by its deviation from identity (0 there): the 2x-speed view
      // must have rotated further in the same one second of tick.
      const baseDeviation = Math.abs(base.matrix()[1] - IDENTITY[1]);
      const fastDeviation = Math.abs(fast.matrix()[1] - IDENTITY[1]);
      expect(fastDeviation).toBeGreaterThan(baseDeviation);
    });
  });

  describe("rotate", () => {
    it("changes the rotor when given a non-zero xw delta", () => {
      const view = new FourDView();
      view.reset(true);

      view.rotate(0.5, 0, 0);

      expect(maxDeviationFromIdentity(view.matrix())).toBeGreaterThan(0.01);
    });

    it("is a no-op when all three deltas are zero", () => {
      const view = new FourDView();
      view.reset(true);

      view.rotate(0, 0, 0);

      expectMatClose(view.matrix(), IDENTITY);
    });
  });

  describe("pose", () => {
    it("returns the current rotor pair and slice fields", () => {
      const view = new FourDView();
      view.reset(true);
      view.rotate(0.3, 0, 0);
      view.sliceOn = true;
      view.sliceCenter = 0.4;
      view.sliceRelColor = true;

      const pose = view.pose();

      expectMatClose(rotorMatrix(pose.pair), view.matrix());
      expect(pose.sliceOn).toBe(true);
      expect(pose.sliceCenter).toBe(0.4);
      expect(pose.sliceRelColor).toBe(true);
    });

    it("deep-copies the rotor: mutating the snapshot leaves the view unchanged", () => {
      const view = new FourDView();
      view.reset(true);
      view.rotate(0.3, 0, 0);
      const before = view.matrix();

      const pose = view.pose();
      pose.pair.p[0] = 999;
      pose.pair.q[1] = 999;

      expectMatClose(view.matrix(), before);
    });
  });

  describe("applyPose", () => {
    it("round-trips: applyPose(pose()) preserves the matrix and slice fields", () => {
      const view = new FourDView();
      view.reset(true);
      view.rotate(0.2, -0.4, 0.1);
      view.sliceOn = true;
      view.sliceCenter = -0.7;
      view.sliceRelColor = true;
      const before = view.matrix();
      const pose = view.pose();

      view.applyPose(pose);

      expectMatClose(view.matrix(), before);
      expect(view.sliceOn).toBe(true);
      expect(view.sliceCenter).toBe(-0.7);
      expect(view.sliceRelColor).toBe(true);
    });

    it("round-trips the slice slab's thickness through pose()/applyPose()", () => {
      const source = new FourDView();
      source.reset(true);
      source.sliceThickness = 0.32;

      const target = new FourDView();
      target.applyPose(source.pose());

      expect(target.sliceThickness).toBe(0.32);
    });

    it("restores a pose captured from a different view instance", () => {
      const source = new FourDView();
      source.reset(true);
      source.rotate(0.5, 0, 0.2);
      source.sliceCenter = 0.3;
      const pose = source.pose();

      const target = new FourDView();
      target.applyPose(pose);

      expectMatClose(target.matrix(), source.matrix());
      expect(target.sliceCenter).toBe(0.3);
    });

    it("normalizes a hand-scaled pair to match the unscaled rotation", () => {
      const view = new FourDView();
      view.reset(true);
      view.rotate(0.3, 0, 0);
      const unscaledMatrix = view.matrix();
      const pose = view.pose();
      const scaledPose: FourDPose = {
        ...pose,
        pair: {
          p: [
            pose.pair.p[0] * 3,
            pose.pair.p[1] * 3,
            pose.pair.p[2] * 3,
            pose.pair.p[3] * 3,
          ],
          q: [
            pose.pair.q[0] * 3,
            pose.pair.q[1] * 3,
            pose.pair.q[2] * 3,
            pose.pair.q[3] * 3,
          ],
        },
      };

      const target = new FourDView();
      target.applyPose(scaledPose);

      expectMatClose(target.matrix(), unscaledMatrix);
    });

    it("keeps the current rotor when the pose's pair is degenerate, but still applies the slice fields", () => {
      const view = new FourDView();
      view.reset(true);
      view.rotate(0.4, 0, 0);
      const before = view.matrix();
      const degeneratePose: FourDPose = {
        pair: { p: [0, 0, 0, 0], q: [0, 0, 0, 0] },
        sliceOn: true,
        sliceCenter: 0.9,
        sliceThickness: 0,
        sliceRelColor: true,
      };

      view.applyPose(degeneratePose);

      expectMatClose(view.matrix(), before);
      expect(view.sliceOn).toBe(true);
      expect(view.sliceCenter).toBe(0.9);
      expect(view.sliceRelColor).toBe(true);
    });

    it("never touches tumbleOn/tumbleSpeed", () => {
      const view = new FourDView();
      view.reset(true);
      view.tumbleOn = false;
      view.tumbleSpeed = 2.5;
      const pose = view.pose();

      view.applyPose(pose);

      expect(view.tumbleOn).toBe(false);
      expect(view.tumbleSpeed).toBe(2.5);
    });
  });
});

describe("FourDTween", () => {
  it("snaps immediately under reduced motion", () => {
    const view = new FourDView();
    view.reset(true);
    const clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => true,
    );
    const targetPose: FourDPose = {
      pair: rotateInPlane(identityRotorPair(), "xy", 0.8),
      sliceOn: true,
      sliceCenter: 0.5,
      sliceThickness: 0,
      sliceRelColor: true,
    };

    tween.glideToPose(targetPose, 1000);

    expectMatClose(view.matrix(), rotorMatrix(targetPose.pair));
    expect(view.sliceOn).toBe(true);
    expect(view.sliceCenter).toBe(0.5);
    expect(view.sliceRelColor).toBe(true);
    expect(tween.active).toBe(false);
  });

  it("snaps immediately when durationMs is 0", () => {
    const view = new FourDView();
    view.reset(true);
    const clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: rotateInPlane(identityRotorPair(), "xy", 0.8),
      sliceOn: true,
      sliceCenter: 0.5,
      sliceThickness: 0,
      sliceRelColor: true,
    };

    tween.glideToPose(targetPose, 0);

    expectMatClose(view.matrix(), rotorMatrix(targetPose.pair));
    expect(tween.active).toBe(false);
  });

  it("interpolates the rotor and slice center partway through a normal glide", () => {
    const view = new FourDView();
    view.reset(true); // rotor at identity, sliceCenter 0
    let clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: rotateInPlane(identityRotorPair(), "xy", 0.8),
      sliceOn: true,
      sliceCenter: 0.5,
      sliceThickness: 0,
      sliceRelColor: true,
    };

    tween.glideToPose(targetPose, 1000);
    clock = 500;
    tween.advance();

    // smoothstep(0.5) = 0.5, so sliceCenter is halfway from 0 to 0.5.
    expect(view.sliceCenter).toBeCloseTo(0.25);
    // Booleans establish from the target immediately, not partway.
    expect(view.sliceOn).toBe(true);
    expect(view.sliceRelColor).toBe(true);
    // The rotor sits at the smoothstep midpoint: half of the xy rotation's
    // own half-angle.
    expectMatClose(
      view.matrix(),
      rotorMatrix(rotateInPlane(identityRotorPair(), "xy", 0.4)),
    );
    expect(tween.active).toBe(true);
  });

  it("interpolates the slice thickness partway through a normal glide", () => {
    const view = new FourDView();
    view.reset(true); // sliceThickness 0
    let clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: identityRotorPair(),
      sliceOn: false,
      sliceCenter: 0,
      sliceThickness: 0.4,
      sliceRelColor: false,
    };

    tween.glideToPose(targetPose, 1000);
    clock = 500;
    tween.advance();

    // smoothstep(0.5) = 0.5, so the slab is half as thick as its target —
    // the same continuous lerp sliceCenter gets, not a jump to the target.
    expect(view.sliceThickness).toBeCloseTo(0.2);
    expect(tween.active).toBe(true);
  });

  it("glides the slice thickness from a widened slab back down to a target cross-section", () => {
    const view = new FourDView();
    view.reset(true);
    view.sliceThickness = 0.5;
    let clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: identityRotorPair(),
      sliceOn: false,
      sliceCenter: 0,
      sliceThickness: 0,
      sliceRelColor: false,
    };

    tween.glideToPose(targetPose, 1000);
    clock = 500;
    tween.advance();

    // The glide starts from the LIVE thickness, not from zero: halfway down
    // from 0.5 is 0.25.
    expect(view.sliceThickness).toBeCloseTo(0.25);
  });

  it("lands exactly on the target at/after the glide's duration", () => {
    const view = new FourDView();
    view.reset(true);
    let clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: rotateInPlane(identityRotorPair(), "xy", 0.8),
      sliceOn: true,
      sliceCenter: 0.5,
      sliceThickness: 0,
      sliceRelColor: true,
    };

    tween.glideToPose(targetPose, 1000);
    clock = 1000;
    tween.advance();

    expectMatClose(view.matrix(), rotorMatrix(targetPose.pair));
    expect(view.sliceCenter).toBe(0.5);
    expect(tween.active).toBe(false);
  });

  it("cancel() stops the glide without moving the view further", () => {
    const view = new FourDView();
    view.reset(true);
    let clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: rotateInPlane(identityRotorPair(), "xy", 0.8),
      sliceOn: true,
      sliceCenter: 0.5,
      sliceThickness: 0,
      sliceRelColor: true,
    };
    tween.glideToPose(targetPose, 1000);
    clock = 500;
    tween.advance();
    const midMatrix = view.matrix();
    const midCenter = view.sliceCenter;

    tween.cancel();
    clock = 1000;
    tween.advance(); // now a no-op

    expectMatClose(view.matrix(), midMatrix);
    expect(view.sliceCenter).toBe(midCenter);
    expect(tween.active).toBe(false);
  });

  it("finish() snaps to the target and deactivates", () => {
    const view = new FourDView();
    view.reset(true);
    let clock = 0;
    const tween = new FourDTween(
      view,
      () => clock,
      () => false,
    );
    const targetPose: FourDPose = {
      pair: rotateInPlane(identityRotorPair(), "xy", 0.8),
      sliceOn: true,
      sliceCenter: 0.5,
      sliceThickness: 0,
      sliceRelColor: true,
    };
    tween.glideToPose(targetPose, 1000);
    clock = 300;
    tween.advance();

    tween.finish();

    expectMatClose(view.matrix(), rotorMatrix(targetPose.pair));
    expect(view.sliceCenter).toBe(0.5);
    expect(tween.active).toBe(false);
  });

  it("finish() is a no-op when idle", () => {
    const view = new FourDView();
    view.reset(true);
    const before = view.matrix();
    const tween = new FourDTween(
      view,
      () => 0,
      () => false,
    );

    tween.finish();

    expectMatClose(view.matrix(), before);
    expect(tween.active).toBe(false);
  });
});

describe("viewTransition", () => {
  it("resets nothing for a flat edit staying flat", () => {
    expect(viewTransition(false, false, false)).toEqual({
      resetFourD: false,
      resetAutoOrbit: false,
      clearScaffold: false,
    });
  });

  it("resets the auto-orbit for a flat-to-flat whole-system replacement", () => {
    expect(viewTransition(false, false, true)).toEqual({
      resetFourD: false,
      resetAutoOrbit: true,
      clearScaffold: false,
    });
  });

  it("resets the auto-orbit and clears the scaffold when a w-slider flattens a 4D system", () => {
    expect(viewTransition(false, true, false)).toEqual({
      resetFourD: false,
      resetAutoOrbit: true,
      clearScaffold: true,
    });
  });

  it("resets the auto-orbit and clears the scaffold for a 4D-to-flat whole-system replacement", () => {
    expect(viewTransition(false, true, true)).toEqual({
      resetFourD: false,
      resetAutoOrbit: true,
      clearScaffold: true,
    });
  });

  it("resets the 4D view when a w-slider lifts a flat system into 4D", () => {
    expect(viewTransition(true, false, false)).toEqual({
      resetFourD: true,
      resetAutoOrbit: false,
      clearScaffold: false,
    });
  });

  it("resets the 4D view for a flat-to-4D whole-system replacement", () => {
    expect(viewTransition(true, false, true)).toEqual({
      resetFourD: true,
      resetAutoOrbit: false,
      clearScaffold: false,
    });
  });

  it("resets nothing for a mere edit to an already-4D system, preserving an in-progress tumble/slice", () => {
    // The crucial case: a slider nudge on a system that was already 4D and
    // stays 4D must not throw away a tumble the user paused or a slice
    // window they dragged into place.
    expect(viewTransition(true, true, false)).toEqual({
      resetFourD: false,
      resetAutoOrbit: false,
      clearScaffold: false,
    });
  });

  it("resets the 4D view for a 4D-to-4D whole-system replacement (fresh-visit swap)", () => {
    // The crucial counterpart to the previous case: swapping straight from
    // one non-flat system to another (e.g. the double-rotation spiral to the
    // pentatope) still counts as a fresh visit and DOES reset the view, even
    // though both the old and the new system are 4D.
    expect(viewTransition(true, true, true)).toEqual({
      resetFourD: true,
      resetAutoOrbit: false,
      clearScaffold: false,
    });
  });
});
