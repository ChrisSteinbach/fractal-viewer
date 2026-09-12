import {
  CONTENTION_MS_PER_SECOND,
  DESKTOP_COMMS,
  classifyContention,
  formatQuietLine,
  parseFdinfo,
} from "./lib/machine-quiet.mjs";

/**
 * The quietness check exists so a GPU measurement can carry evidence of its
 * own conditions, and the one output that would make it worse than the
 * instruction it replaces is a FALSE quiet. So what is pinned here is the
 * text parsing and the threshold rule — both pure over already-sampled
 * inputs for exactly this reason — with no /proc and no GPU under the test.
 */
describe("parseFdinfo", () => {
  it("sums every engine counter a DRM client exposes", () => {
    const parsed = parseFdinfo(
      [
        "pos:\t0",
        "drm-driver:\tamdgpu",
        "drm-client-id:\t59",
        "drm-engine-gfx:\t700000000 ns",
        "drm-engine-compute:\t155000000 ns",
      ].join("\n"),
    );
    expect(parsed?.busyNs).toBe(855_000_000);
  });

  it("returns null for an fdinfo that is not a DRM client's", () => {
    expect(parseFdinfo("pos:\t0\nflags:\t02\nmnt_id:\t30")).toBe(null);
  });

  it("returns the client id so dup'd descriptors can be deduped", () => {
    const parsed = parseFdinfo(
      "drm-driver:\tamdgpu\ndrm-client-id:\t59\ndrm-engine-gfx:\t5 ns",
    );
    expect(parsed?.clientId).toBe("59");
  });

  it("reports zero engine time for a client that has used none", () => {
    const parsed = parseFdinfo("drm-driver:\ti915\ndrm-total-vram:\t64 KiB");
    expect(parsed).toMatchObject({ busyNs: 0, sawEngine: false });
  });
});

describe("classifyContention", () => {
  it("calls a process above the threshold a contender", () => {
    const before = new Map([[4635, { comm: "firefox", busyNs: 0 }]]);
    const after = new Map([[4635, { comm: "firefox", busyNs: 91_000_000 }]]);
    const result = classifyContention(before, after, { windowMs: 1000 });
    expect(result.contended).toBe(true);
    expect(result.competing).toEqual([
      { pid: 4635, comm: "firefox", busyMsPerSecond: 91 },
    ]);
  });

  it("leaves a process below the threshold out of the verdict", () => {
    const before = new Map([[7, { comm: "code", busyNs: 0 }]]);
    const after = new Map([[7, { comm: "code", busyNs: 3_000_000 }]]);
    const result = classifyContention(before, after, { windowMs: 1000 });
    expect(result.contended).toBe(false);
    expect(result.others).toEqual([
      { pid: 7, comm: "code", busyMsPerSecond: 3 },
    ]);
  });

  it("reports the compositor without counting it against the verdict", () => {
    const before = new Map([[3692, { comm: "gnome-shell", busyNs: 0 }]]);
    const after = new Map([
      [3692, { comm: "gnome-shell", busyNs: 400_000_000 }],
    ]);
    const result = classifyContention(before, after, { windowMs: 1000 });
    expect(result.contended).toBe(false);
    expect(result.ignored).toEqual([
      { pid: 3692, comm: "gnome-shell", busyMsPerSecond: 400 },
    ]);
  });

  it("excludes the caller's own pids", () => {
    const before = new Map([[99, { comm: "chrome", busyNs: 0 }]]);
    const after = new Map([[99, { comm: "chrome", busyNs: 900_000_000 }]]);
    const result = classifyContention(before, after, {
      windowMs: 1000,
      ignorePids: [99],
    });
    expect(result.contended).toBe(false);
    expect(result.others).toEqual([]);
  });

  it("scales the rate by the sampling window", () => {
    const before = new Map([[5, { comm: "blender", busyNs: 0 }]]);
    const after = new Map([[5, { comm: "blender", busyNs: 120_000_000 }]]);
    const result = classifyContention(before, after, { windowMs: 2000 });
    expect(result.others[0].busyMsPerSecond).toBe(60);
  });

  it("ignores a counter that went backwards under a recycled pid", () => {
    const before = new Map([[11, { comm: "gimp", busyNs: 900_000_000 }]]);
    const after = new Map([[11, { comm: "gimp", busyNs: 1_000_000 }]]);
    const result = classifyContention(before, after, { windowMs: 1000 });
    expect(result.others).toEqual([]);
  });

  it("counts a client that appeared only in the second sample", () => {
    const after = new Map([[12, { comm: "steam", busyNs: 200_000_000 }]]);
    const result = classifyContention(new Map(), after, { windowMs: 1000 });
    expect(result.contended).toBe(true);
  });

  it("sorts contenders by GPU time descending", () => {
    const after = new Map([
      [1, { comm: "a", busyNs: 10_000_000 }],
      [2, { comm: "b", busyNs: 300_000_000 }],
      [3, { comm: "c", busyNs: 90_000_000 }],
    ]);
    const result = classifyContention(new Map(), after, { windowMs: 1000 });
    expect(result.others.map((o: { comm: string }) => o.comm)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("formatQuietLine", () => {
  it("says UNKNOWN rather than letting silence read as quiet", () => {
    const line = formatQuietLine({
      contended: null,
      unknownReason: "no DRM client exposed engine time",
      others: [],
      ignored: [],
      competing: [],
      gpuBusyPercent: null,
      loadavg1: 0.5,
      windowMs: 1000,
      thresholdMsPerSecond: CONTENTION_MS_PER_SECOND,
    });
    expect(line).toContain("quiet=UNKNOWN");
    expect(line).not.toContain("quiet=YES");
  });

  it("names the contenders when the machine is busy", () => {
    const line = formatQuietLine({
      contended: true,
      unknownReason: null,
      others: [{ pid: 4635, comm: "firefox", busyMsPerSecond: 91 }],
      ignored: [],
      competing: [{ pid: 4635, comm: "firefox", busyMsPerSecond: 91 }],
      gpuBusyPercent: 13,
      loadavg1: 1.48,
      windowMs: 1000,
      thresholdMsPerSecond: CONTENTION_MS_PER_SECOND,
    });
    expect(line).toContain("quiet=NO");
    expect(line).toContain("firefox[4635] 91ms/s");
  });

  it("still reports the desktop processes it excluded from the verdict", () => {
    const line = formatQuietLine({
      contended: false,
      unknownReason: null,
      others: [],
      ignored: [{ pid: 3692, comm: "gnome-shell", busyMsPerSecond: 27 }],
      competing: [],
      gpuBusyPercent: 13,
      loadavg1: 0.9,
      windowMs: 1000,
      thresholdMsPerSecond: CONTENTION_MS_PER_SECOND,
    });
    expect(line).toContain("quiet=YES");
    expect(line).toContain("desktop: gnome-shell[3692] 27ms/s");
  });
});

describe("DESKTOP_COMMS", () => {
  it("carries the 15-char truncation /proc/<pid>/comm can produce", () => {
    expect(DESKTOP_COMMS).toContain("gnome-shell");
    expect(DESKTOP_COMMS).toContain("gnome-shel");
  });
});
