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
 * standing in for CloudGenerator.peekNextId's monotonic counter. Every test
 * follows the real call order: a load opens with clearAll() (which captures
 * the await key), the apply may advance the counter (posting requests), and
 * the arms run after. */
function hintsAt(counter: { id: number }): PendingLoadHints {
  return new PendingLoadHints(() => counter.id);
}

describe("PendingLoadHints", () => {
  describe("takeMode", () => {
    it("survives a stale replaced arrival from the previous load — the load-hint interleaving", () => {
      // Load N's terminal replaced request went out with id 4; the
      // backgrounded-tab catch-up frame launches load N+1 in the same tick,
      // whose opening clear captures the key while ids 5+ are unposted.
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armMode("flame");
      // Load N's arrival lands first. It must not consume the hint...
      expect(hints.takeMode({ id: 4, replaced: true })).toBeNull();
      // ...and the hint must still be armed for load N+1's own landing.
      expect(hints.takeMode({ id: 5, replaced: true })).toBe("flame");
    });

    it("consumes on the awaited load's own replaced arrival, then disarms", () => {
      const counter = { id: 7 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armMode("solid");
      expect(hints.takeMode({ id: 7, replaced: true })).toBe("solid");
      expect(hints.takeMode({ id: 8, replaced: true })).toBeNull();
    });

    it("consumes on a LATER id than the key — a morphing load's terminal request is posted at morph end, many intermediates later", () => {
      const counter = { id: 10 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armMode("flame");
      expect(hints.takeMode({ id: 28, replaced: true })).toBe("flame");
    });

    it("consumes a request the load's own apply posted BEFORE the arm ran — a reduced-motion load regenerates synchronously inside the apply", () => {
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.clearAll(); // key = 5, captured at the top of the apply
      counter.id = 6; // the apply posted the load's own replaced request (5)
      hints.armMode("flame"); // armed after — the real call order
      // The load's own request must still fire the hint: the key was
      // captured at the clear, not here, or this arrival would be refused
      // and the hint stranded (the roast-found regression this test pins).
      expect(hints.takeMode({ id: 5, replaced: true })).toBe("flame");
    });

    it("draws the line at the load boundary, not inside the load's own tick — a snapped previous morph's terminal (posted during the apply) may consume, exactly as before the epoch key existed", () => {
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.clearAll(); // key = 5
      counter.id = 7; // the apply posted ids 5 (snapMorph terminal) and 6 (own)
      hints.armMode("flame");
      expect(hints.takeMode({ id: 4, replaced: true })).toBeNull(); // pre-load: refused
      expect(hints.takeMode({ id: 5, replaced: true })).toBe("flame"); // in-load: allowed
    });

    it("never consumes on a replaced:false arrival, whatever its id — a morph's intermediates pass over the hint", () => {
      const counter = { id: 3 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armMode("flame");
      expect(hints.takeMode({ id: 9, replaced: false })).toBeNull();
      expect(hints.takeMode({ id: 10, replaced: true })).toBe("flame");
    });

    it("arming null is a real arm — onPreset clears the hint for a hint-less preset", () => {
      const counter = { id: 2 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armMode("flame");
      hints.armMode(null);
      expect(hints.takeMode({ id: 2, replaced: true })).toBeNull();
    });

    it("exposes the armed mode un-consumed for the timeline hold check", () => {
      const hints = hintsAt({ id: 1 });
      expect(hints.mode).toBeNull();
      hints.clearAll();
      hints.armMode("solid");
      expect(hints.mode).toBe("solid");
      // Reading never consumes.
      expect(hints.mode).toBe("solid");
    });
  });

  describe("pose hints", () => {
    it("keeps the target Saved-view pose in persistence before its cloud lands", () => {
      const hints = hintsAt({ id: 5 });
      const outgoing = pose(-0.6);
      const target = pose(0.4);
      hints.clearAll();
      hints.armPose(target);

      expect(hints.poseForDocument(outgoing)).toBe(target);

      hints.releasePose({ id: 5, replaced: true });
      expect(hints.poseForDocument(outgoing)).toBe(outgoing);
    });

    it("treats a target document with no FourDPose as an armed absence", () => {
      const hints = hintsAt({ id: 5 });
      const outgoing = pose(-0.6);
      hints.clearAll();
      hints.armPose(null);

      expect(hints.poseForDocument(outgoing)).toBeUndefined();
      expect(hints.poseFor({ id: 5, replaced: true })).toBeNull();
    });

    it("hands persistence back to the live pose when the user supersedes the hint", () => {
      const hints = hintsAt({ id: 5 });
      const live = pose(-0.2);
      hints.clearAll();
      hints.armPose(pose(0.8));
      hints.clearPose();

      expect(hints.poseForDocument(live)).toBe(live);
    });

    it("a stale flat replaced arrival no longer discards the next load's pose — the silent 4D data loss the await key fixes", () => {
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.clearAll();
      const saved = pose(0.4);
      hints.armPose(saved);
      // The undone system's flat arrival (id 4, replaced) lands after the
      // real load armed. Before the epoch key it nulled the pose
      // unconditionally and the restored scene fell to resetFourDView.
      hints.releasePose({ id: 4, replaced: true });
      expect(hints.poseFor({ id: 5, replaced: true })).toBe(saved);
    });

    it("an undo across a replace lands its pose even though the restore posts its request inside the apply", () => {
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.clearAll(); // restoreSnapshot's apply opens here: key = 5
      counter.id = 6; // ...and posts the restore's own replaced request (5)
      hints.armPose(pose(0.7)); // armed after the apply returns
      // The restore's own arrival must apply AND release the pose — with an
      // arm-time key it would be refused and the saved pose silently lost,
      // the exact symptom the await key exists to fix (roast-found regression).
      expect(hints.poseFor({ id: 5, replaced: true })).not.toBeNull();
      hints.releasePose({ id: 5, replaced: true });
      expect(hints.poseFor({ id: 6, replaced: true })).toBeNull();
    });

    it("releases on the awaited load's own replaced landing, even a flat one", () => {
      const counter = { id: 5 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armPose(pose());
      hints.releasePose({ id: 5, replaced: true });
      expect(hints.poseFor({ id: 6, replaced: true })).toBeNull();
    });

    it("poseFor serves the awaited load's replaced:false intermediates — the morph's first non-flat arrival shows the destination orientation", () => {
      const counter = { id: 10 };
      const hints = hintsAt(counter);
      hints.clearAll();
      const saved = pose(0.2);
      hints.armPose(saved);
      expect(hints.poseFor({ id: 13, replaced: false })).toBe(saved);
      // Serving an intermediate is a read, never a release: the terminal
      // arrival still finds the pose.
      expect(hints.poseFor({ id: 20, replaced: true })).toBe(saved);
    });

    it("poseFor refuses a stale arrival — the previous load's cloud must not take the next load's pose", () => {
      const counter = { id: 10 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armPose(pose());
      expect(hints.poseFor({ id: 9, replaced: false })).toBeNull();
      expect(hints.poseFor({ id: 9, replaced: true })).toBeNull();
    });

    it("replaced:false arrivals never release, whatever their id", () => {
      const counter = { id: 10 };
      const hints = hintsAt(counter);
      hints.clearAll();
      const saved = pose();
      hints.armPose(saved);
      hints.releasePose({ id: 15, replaced: false });
      expect(hints.poseFor({ id: 16, replaced: true })).toBe(saved);
    });

    it("clearPose drops the pose but keeps mode and seed — a rotor grab must not cancel a timeline leg's render entry", () => {
      const counter = { id: 4 };
      const hints = hintsAt(counter);
      hints.clearAll();
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
      hints.clearAll();
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
      const counter = { id: 6 };
      const hints = hintsAt(counter);
      hints.clearAll();
      hints.armMode("flame");
      hints.armSeed(7);
      hints.armPose(pose());
      hints.clearAll();
      expect(hints.mode).toBeNull();
      expect(hints.takeMode({ id: 6, replaced: true })).toBeNull();
      expect(hints.takeSeed()).toBeNull();
      expect(hints.poseFor({ id: 6, replaced: true })).toBeNull();
    });

    it("re-keys the window — load B's clear closes load A's window, so A's in-flight requests cannot touch B's hints", () => {
      const counter = { id: 3 };
      const hints = hintsAt(counter);
      hints.clearAll(); // load A opens
      hints.armMode("flame");
      counter.id = 7; // A's requests went out (ids 3..6)
      hints.clearAll(); // load B opens: key = 7
      hints.armMode("solid");
      expect(hints.takeMode({ id: 6, replaced: true })).toBeNull();
      expect(hints.takeMode({ id: 7, replaced: true })).toBe("solid");
    });

    it("arms never move the key — a load arming twice (pose from loadEncodedScene, mode from its caller) keeps one shared window", () => {
      const counter = { id: 2 };
      const hints = hintsAt(counter);
      hints.clearAll(); // key = 2
      counter.id = 3; // the apply posted the load's own request (2)
      hints.armPose(pose());
      hints.armMode("flame"); // a second arm, later in the same load
      // Both hints answer to the load's own request — the second arm did
      // not slide the window past it.
      expect(hints.poseFor({ id: 2, replaced: true })).not.toBeNull();
      expect(hints.takeMode({ id: 2, replaced: true })).toBe("flame");
    });
  });
});
