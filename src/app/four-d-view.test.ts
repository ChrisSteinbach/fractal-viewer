import { FourDView, viewTransition } from "./four-d-view";

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
    it("leaves the rotor at identity and the fields at baseline when motion is not reduced", () => {
      const view = new FourDView();

      view.reset(false);

      expectMatClose(view.matrix(), IDENTITY);
      expect(view.tumbleOn).toBe(true);
      expect(view.tumbleSpeed).toBe(1);
      expect(view.sliceOn).toBe(false);
      expect(view.sliceCenter).toBe(0);
      expect(view.sliceRelColor).toBe(false);
    });

    it("pauses the tumble but seeds a non-identity rotor under reduced motion", () => {
      const view = new FourDView();

      view.reset(true);

      expect(view.tumbleOn).toBe(false);
      // A paused projection sitting exactly on the identity view would look
      // indistinguishable from the flat 3D embed, so reset(true) pre-seeds a
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

      view.reset(false);

      expect(view.sliceOn).toBe(false);
      expect(view.sliceCenter).toBe(0);
      expect(view.sliceRelColor).toBe(false);
      expect(view.tumbleOn).toBe(true);
      expect(view.tumbleSpeed).toBe(1);
    });
  });

  describe("setTumbleUserChoice", () => {
    it("turns the tumble off immediately, without needing a reset", () => {
      const view = new FourDView();

      view.setTumbleUserChoice(false);

      expect(view.tumbleOn).toBe(false);
    });

    it("keeps the tumble off across a fresh-visit reset once the user has turned it off", () => {
      const view = new FourDView();
      view.reset(false);

      view.setTumbleUserChoice(false);
      view.reset(false);

      expect(view.tumbleOn).toBe(false);
    });

    it("still pre-seeds a non-identity rotor when a sticky off choice leaves the tumble paused after reset", () => {
      const view = new FourDView();
      view.reset(false);
      view.setTumbleUserChoice(false);

      view.reset(false);

      // A paused projection sitting exactly on the identity view would look
      // indistinguishable from the flat 3D embed, whether the pause comes
      // from reduced motion or, as here, a sticky user choice.
      expect(maxDeviationFromIdentity(view.matrix())).toBeGreaterThan(0.1);
    });

    it("honors a sticky opt-in and keeps tumbling on the next reset even under reduced motion", () => {
      const view = new FourDView();
      view.reset(true); // tumble starts paused under reduced motion

      view.setTumbleUserChoice(true);
      view.reset(true);

      expect(view.tumbleOn).toBe(true);
    });

    it("uses the most recent setTumbleUserChoice call as the sticky choice", () => {
      const view = new FourDView();

      view.setTumbleUserChoice(false);
      view.setTumbleUserChoice(true);
      view.reset(false);

      expect(view.tumbleOn).toBe(true);
    });

    it("still resets speed and slice fields to baseline when the sticky choice keeps the tumble off", () => {
      const view = new FourDView();
      view.setTumbleUserChoice(false);
      view.tumbleSpeed = 3;
      view.sliceOn = true;

      view.reset(false);

      expect(view.tumbleOn).toBe(false);
      expect(view.tumbleSpeed).toBe(1);
      expect(view.sliceOn).toBe(false);
    });

    it("does not treat a direct tumbleOn field write as a sticky choice, unlike setTumbleUserChoice", () => {
      const view = new FourDView();
      view.reset(false);
      view.tumbleOn = false; // bare field write, not through the setter

      view.reset(false);

      // Only setTumbleUserChoice earns stickiness; a programmatic write to
      // the field (as here) must not survive the next fresh-visit reset the
      // way a real user toggle would (contrast the sticky-off case above).
      expect(view.tumbleOn).toBe(true);
    });
  });

  describe("seedTumbleUserChoice", () => {
    it("makes the next reset honor a remembered off choice without a prior in-session toggle", () => {
      const view = new FourDView();

      view.seedTumbleUserChoice(false);
      view.reset(false); // not reduced motion, so the bare default would be ON

      expect(view.tumbleOn).toBe(false);
    });

    it("makes the next reset keep tumbling for a remembered opt-in even under reduced motion", () => {
      const view = new FourDView();

      view.seedTumbleUserChoice(true);
      view.reset(true); // reduced motion, so the bare default would be paused

      expect(view.tumbleOn).toBe(true);
    });

    it("does not touch the live tumbleOn until a reset applies the seeded choice", () => {
      const view = new FourDView();
      expect(view.tumbleOn).toBe(true); // constructor default

      view.seedTumbleUserChoice(false);

      // Unlike setTumbleUserChoice, seeding only records the choice for the
      // imminent boot reset to apply — it must not flip live state itself.
      expect(view.tumbleOn).toBe(true);
    });
  });

  describe("tick", () => {
    it("advances the rotor away from identity while the tumble is running", () => {
      const view = new FourDView();
      view.reset(false);

      view.tick(1);

      expect(maxDeviationFromIdentity(view.matrix())).toBeGreaterThan(0.01);
    });

    it("is a no-op while the tumble is paused", () => {
      const view = new FourDView();
      view.reset(false);
      view.tumbleOn = false;

      view.tick(10);

      expectMatClose(view.matrix(), IDENTITY);
    });

    it("rotates further at a higher tumbleSpeed", () => {
      const base = new FourDView();
      base.reset(false);
      base.tick(1);

      const fast = new FourDView();
      fast.reset(false);
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
      view.reset(false);

      view.rotate(0.5, 0, 0);

      expect(maxDeviationFromIdentity(view.matrix())).toBeGreaterThan(0.01);
    });

    it("is a no-op when all three deltas are zero", () => {
      const view = new FourDView();
      view.reset(false);

      view.rotate(0, 0, 0);

      expectMatClose(view.matrix(), IDENTITY);
    });
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
