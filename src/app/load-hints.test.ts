import { PendingLoadHints } from "./load-hints";
import type { FourDPose } from "./four-d-view";

/** A distinguishable 4D pose — the tests only ever compare identity. */
function pose(sliceCenter = 0): FourDPose {
  return {
    pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
    sliceOn: false,
    sliceCenter,
    sliceThickness: 0,
    sliceRelColor: false,
  };
}

/** A hints instance whose next-request id the test scripts by mutation —
 * standing in for CloudGenerator.peekNextId's monotonic counter. */
function hintsAt(counter: { id: number }): PendingLoadHints {
  return new PendingLoadHints(() => counter.id);
}

describe("PendingLoadHints", () => {
  describe("takeMode", () => {
    it("survives a stale replaced arrival from the previous load — the fr-vja8.34 interleaving", () => {
      // Load N's terminal replaced request went out with id 4; the
      // backgrounded-tab catch-up frame launches load N+1 in the same tick,
      // arming its mode hint while ids 5+ are still unposted.
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.armMode("flame");
      // Load N's arrival lands first. It must not consume the hint...
      expect(hints.takeMode({ id: 4, replaced: true })).toBeNull();
      // ...and the hint must still be armed for load N+1's own landing.
      expect(hints.takeMode({ id: 5, replaced: true })).toBe("flame");
    });

    it("consumes on the awaited load's own replaced arrival, then disarms", () => {
      const hints = hintsAt({ id: 7 });
      hints.armMode("solid");
      expect(hints.takeMode({ id: 7, replaced: true })).toBe("solid");
      expect(hints.takeMode({ id: 8, replaced: true })).toBeNull();
    });

    it("consumes on a LATER id than armed — a morphing load's terminal request is posted at morph end, many intermediates later", () => {
      const hints = hintsAt({ id: 10 });
      hints.armMode("flame");
      expect(hints.takeMode({ id: 28, replaced: true })).toBe("flame");
    });

    it("never consumes on a replaced:false arrival, whatever its id — a morph's intermediates pass over the hint", () => {
      const hints = hintsAt({ id: 3 });
      hints.armMode("flame");
      expect(hints.takeMode({ id: 9, replaced: false })).toBeNull();
      expect(hints.takeMode({ id: 10, replaced: true })).toBe("flame");
    });

    it("arming null is a real arm — onPreset clears the hint for a hint-less preset", () => {
      const hints = hintsAt({ id: 2 });
      hints.armMode("flame");
      hints.armMode(null);
      expect(hints.takeMode({ id: 2, replaced: true })).toBeNull();
    });

    it("exposes the armed mode un-consumed for the timeline hold check", () => {
      const hints = hintsAt({ id: 1 });
      expect(hints.mode).toBeNull();
      hints.armMode("solid");
      expect(hints.mode).toBe("solid");
      // Reading never consumes.
      expect(hints.mode).toBe("solid");
    });
  });

  describe("pose hints", () => {
    it("a stale flat replaced arrival no longer discards the next load's pose — the silent 4D data loss fr-vja8.34 fixes", () => {
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      const saved = pose(0.4);
      hints.armPose(saved);
      // The undone system's flat arrival (id 4, replaced) lands after the
      // real load armed. Before the epoch key it nulled the pose
      // unconditionally and the restored scene fell to resetFourDView.
      hints.releasePose({ id: 4, replaced: true });
      expect(hints.poseFor({ id: 5, replaced: true })).toBe(saved);
    });

    it("releases on the awaited load's own replaced landing, even a flat one", () => {
      const hints = hintsAt({ id: 5 });
      hints.armPose(pose());
      hints.releasePose({ id: 5, replaced: true });
      expect(hints.poseFor({ id: 6, replaced: true })).toBeNull();
    });

    it("poseFor serves the awaited load's replaced:false intermediates — the morph's first non-flat arrival shows the destination orientation", () => {
      const hints = hintsAt({ id: 10 });
      const saved = pose(0.2);
      hints.armPose(saved);
      expect(hints.poseFor({ id: 13, replaced: false })).toBe(saved);
      // Serving an intermediate is a read, never a release: the terminal
      // arrival still finds the pose.
      expect(hints.poseFor({ id: 20, replaced: true })).toBe(saved);
    });

    it("poseFor refuses a stale arrival — the previous load's cloud must not take the next load's pose", () => {
      const hints = hintsAt({ id: 10 });
      hints.armPose(pose());
      expect(hints.poseFor({ id: 9, replaced: false })).toBeNull();
      expect(hints.poseFor({ id: 9, replaced: true })).toBeNull();
    });

    it("replaced:false arrivals never release, whatever their id", () => {
      const hints = hintsAt({ id: 10 });
      const saved = pose();
      hints.armPose(saved);
      hints.releasePose({ id: 15, replaced: false });
      expect(hints.poseFor({ id: 16, replaced: true })).toBe(saved);
    });

    it("clearPose drops the pose but keeps mode and seed — a rotor grab must not cancel a timeline leg's render entry", () => {
      const hints = hintsAt({ id: 4 });
      hints.armPose(pose());
      hints.armMode("flame");
      hints.armSeed(123);
      hints.clearPose();
      expect(hints.poseFor({ id: 4, replaced: true })).toBeNull();
      expect(hints.takeMode({ id: 4, replaced: true })).toBe("flame");
      expect(hints.takeSeed()).toBe(123);
    });
  });

  describe("takeSeed", () => {
    it("takes unconditionally and disarms — the session start the mode hint triggered consumes it, whenever that runs", () => {
      const hints = hintsAt({ id: 1 });
      hints.armSeed(42);
      expect(hints.takeSeed()).toBe(42);
      expect(hints.takeSeed()).toBeNull();
    });

    it("returns null when nothing is armed — every other start rolls its own", () => {
      expect(hintsAt({ id: 1 }).takeSeed()).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("drops all three hints — applyEdit / applyDecodedSnapshot / a manual mode switch supersede whatever was waiting", () => {
      const hints = hintsAt({ id: 6 });
      hints.armMode("flame");
      hints.armSeed(7);
      hints.armPose(pose());
      hints.clearAll();
      expect(hints.mode).toBeNull();
      expect(hints.takeMode({ id: 6, replaced: true })).toBeNull();
      expect(hints.takeSeed()).toBeNull();
      expect(hints.poseFor({ id: 6, replaced: true })).toBeNull();
    });
  });

  describe("await key maintenance", () => {
    it("re-arming reads the CURRENT next id — a later load is not gated behind an earlier load's key", () => {
      const counter = { id: 3 };
      const hints = hintsAt(counter);
      hints.armMode("flame");
      // Load A's own requests went out (ids 3..6); a fresh load B arms at 7.
      counter.id = 7;
      hints.armMode("solid");
      expect(hints.takeMode({ id: 6, replaced: true })).toBeNull();
      expect(hints.takeMode({ id: 7, replaced: true })).toBe("solid");
    });

    it("each arm refreshes the shared key — the three hints always belong to the same load", () => {
      const counter = { id: 2 };
      const hints = hintsAt(counter);
      hints.armPose(pose());
      counter.id = 3;
      // The same load arms its mode a statement later (gallery entry:
      // loadEncodedScene arms the pose, the caller arms the mode). The key
      // moves to 3; the pose rides along — it belongs to the same load,
      // whose requests are all still unposted.
      hints.armMode("flame");
      expect(hints.poseFor({ id: 3, replaced: false })).not.toBeNull();
      expect(hints.takeMode({ id: 3, replaced: true })).toBe("flame");
    });
  });
});
