/**
 * IS THE MACHINE ACTUALLY QUIET? The per-process answer, so a GPU
 * measurement can carry evidence of its own conditions instead of an
 * instruction nobody could check.
 *
 * Half this project's GPU gates tell their caller to "run it on a QUIET
 * machine" — `npm run bench:surface` says it in AGENTS.md, the watchdog
 * repro says it in its own header — and until this module there was no way
 * to obey it verifiably. An agent cannot poll the machine's owner before
 * every run, and the owner cannot be expected to coordinate with every
 * agent; so the instruction was an assertion the run made about itself and
 * never checked. A device loss recorded on 11 September may well have been
 * another workload competing for the ring, and nothing recorded enough to
 * tell either way. That is the gap: not that contention is unmeasurable,
 * but that nothing was measuring it.
 *
 * A GLOBAL BUSY PERCENTAGE CANNOT ANSWER THIS.
 * `/sys/class/drm/cardN/device/gpu_busy_percent` (globbed, because the
 * card number is not guaranteed to be card1) is one number for the
 * whole device, so it counts the probe's OWN work. A run that saturates
 * the GPU on purpose — which is exactly what the hang probes do — reads
 * 100% whether or not anyone else is there, and a run that reads 100%
 * before it starts is indistinguishable from one that reads 100% because
 * it started. So the global figure is only ever a PRE-RUN baseline, and
 * the verdict is taken from per-process attribution instead.
 *
 * WHAT ATTRIBUTES: DRM fdinfo, readable with no root and no tracing.
 * Every process holding a DRM fd exposes `/proc/<pid>/fdinfo/<fd>` with a
 * `drm-driver` line and one `drm-engine-<name>:` nanosecond counter per
 * engine it has used. Summing those and differencing two samples ~1 s
 * apart gives each process its own milliseconds of GPU engine time per
 * second of wall — which on this box correctly named `gnome-shell`
 * (112 ms/s) and `firefox` (230 ms/s) as the GPU's users while a third
 * process measured nothing.
 *
 * TWO RULES GOVERN EVERY PATH THROUGH THIS FILE.
 *
 * 1. IT NEVER THROWS. It is called for its side evidence, from probes
 *    whose real work is elsewhere, and a quietness check that takes down
 *    the measurement it was guarding is worse than no check.
 *
 * 2. SILENCE MUST NOT READ AS QUIET. Unreadable sysfs, a denied /proc, a
 *    kernel with no fdinfo engine counters — every one of those reports
 *    `contended: null`, meaning UNKNOWN, and `formatQuietLine` says so in
 *    the line it prints. A false "quiet" is the one output that would make
 *    this module worse than the instruction it replaces, because it would
 *    put a confident word next to a number nobody checked.
 *
 * THE DESKTOP IS REPORTED BUT NOT COUNTED. A headed run — and the real-
 * driver gates are headed by necessity — needs a compositor, so
 * `gnome-shell` or `Xwayland` being on the GPU is a condition of the
 * measurement rather than a competitor for it. Those are excluded from the
 * verdict and still printed, so a reader always sees everything that was
 * on the device and can disagree with the exclusion.
 */

import fs from "node:fs/promises";
import os from "node:os";

/**
 * Milliseconds of GPU engine time per second of wall, above which one
 * other process counts as competing for the device.
 *
 * THIS IS A JUDGEMENT, NOT A MEASUREMENT. 50 ms/s is 5% of one second of
 * one engine: comfortably above the few ms/s a parked desktop app spends
 * blinking a cursor, and far below the 112-230 ms/s a compositor or a
 * browser rendering something real was measured at. Nothing was measured
 * to derive it and no verdict elsewhere depends on its exact value; move
 * it if a run is refused over a process that was doing nothing.
 */
export const CONTENTION_MS_PER_SECOND = 50;

/**
 * The compositor processes a headed run inherently needs on the GPU.
 * Ignored for the verdict, always reported.
 *
 * `/proc/<pid>/comm` TRUNCATES AT 15 CHARACTERS, which is why
 * `gnome-shel` — the truncation a few kernels produce for the shell's
 * threads — is listed beside `gnome-shell` rather than assumed away.
 */
export const DESKTOP_COMMS = Object.freeze([
  "gnome-shell",
  "gnome-shel",
  "Xwayland",
  "kwin_wayland",
]);

/** Where the global, self-inclusive busy percentage lives. */
const GPU_BUSY_GLOB = "/sys/class/drm";

/**
 * One fdinfo file's contents → `{ driver, clientId, busyNs }`, or `null`
 * when the file is not a DRM client's.
 *
 * PURE OVER TEXT so the parsing is testable without a /proc. Engine time
 * is the SUM over `drm-engine-*` lines: a process may use gfx, compute and
 * copy engines at once and all of them are the device being busy on its
 * behalf. `drm-client-id` comes back so a caller can dedupe the dup'd file
 * descriptors a process can hold onto one client, which would otherwise
 * count the same nanoseconds several times.
 */
export function parseFdinfo(text) {
  if (typeof text !== "string" || !text.includes("drm-driver")) return null;
  let driver = null;
  let clientId = null;
  let busyNs = 0;
  let sawEngine = false;
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "drm-driver") driver = value;
    else if (key === "drm-client-id") clientId = value;
    else if (key.startsWith("drm-engine-")) {
      // "<n> ns" on every driver that emits these; tolerate a bare number.
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) {
        busyNs += n;
        sawEngine = true;
      }
    }
  }
  if (driver === null) return null;
  return { driver, clientId, busyNs, sawEngine };
}

/** `/proc/<pid>/comm`, trimmed, or `"?"` when it cannot be read. */
async function readComm(pid) {
  try {
    return (await fs.readFile(`/proc/${pid}/comm`, "utf8")).trim() || "?";
  } catch {
    return "?";
  }
}

/**
 * One sample of every process holding a DRM fd with non-zero engine time:
 * a `Map` of pid → `{ comm, busyNs }`.
 *
 * A pid that vanishes mid-walk, an fdinfo that cannot be opened and a
 * /proc entry that is not a pid are all SKIPPED rather than raised — a
 * process exiting while being counted is the normal case, not a failure.
 * The empty map is therefore ambiguous on its own, which is why
 * `measureGpuContention` treats it as UNKNOWN rather than as quiet.
 */
export async function sampleDrmClients() {
  const clients = new Map();
  let entries;
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return clients;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let fds;
    try {
      fds = await fs.readdir(`/proc/${entry}/fdinfo`);
    } catch {
      continue;
    }
    let busyNs = 0;
    let sawAny = false;
    const seenClients = new Set();
    for (const fd of fds) {
      let text;
      try {
        text = await fs.readFile(`/proc/${entry}/fdinfo/${fd}`, "utf8");
      } catch {
        continue;
      }
      const parsed = parseFdinfo(text);
      if (parsed === null) continue;
      sawAny = true;
      // Dup'd descriptors share a client id; count each client once.
      const key = parsed.clientId ?? `fd:${fd}`;
      if (seenClients.has(key)) continue;
      seenClients.add(key);
      busyNs += parsed.busyNs;
    }
    if (!sawAny || busyNs === 0) continue;
    clients.set(pid, { comm: await readComm(pid), busyNs });
  }
  return clients;
}

/**
 * The set of pids descended from `rootPid`, INCLUDING it — so a caller
 * that launched a browser can exclude its whole process tree from its own
 * contention verdict rather than only the pid it happens to hold.
 *
 * Built from `/proc/<pid>/stat`'s parent field, which is read from the
 * field after the last `)` because a comm may itself contain parentheses
 * and spaces. Unreadable /proc returns just the root, which is the
 * conservative direction: fewer exclusions, so contention is more likely
 * to be reported, never less.
 */
export async function pidTree(rootPid) {
  const tree = new Set([rootPid]);
  let entries;
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return tree;
  }
  /** child pid → parent pid, for every pid readable right now. */
  const parents = new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = await fs.readFile(`/proc/${entry}/stat`, "utf8");
    } catch {
      continue;
    }
    const close = stat.lastIndexOf(")");
    if (close < 0) continue;
    const fields = stat
      .slice(close + 1)
      .trim()
      .split(/\s+/);
    // fields[0] is state, fields[1] is ppid.
    const ppid = Number.parseInt(fields[1] ?? "", 10);
    if (Number.isFinite(ppid)) parents.set(Number(entry), ppid);
  }
  // Walk each pid up to a root; membership is decided by whether the walk
  // reaches rootPid, which needs no ordering of the map.
  for (const pid of parents.keys()) {
    let cursor = pid;
    const seen = new Set();
    while (cursor > 1 && !seen.has(cursor)) {
      seen.add(cursor);
      if (tree.has(cursor)) {
        for (const p of seen) tree.add(p);
        break;
      }
      const next = parents.get(cursor);
      if (next === undefined) break;
      cursor = next;
    }
  }
  return tree;
}

/**
 * Two client samples and a window → the per-process rates, split into the
 * ones that count and the ones that are ignored, plus the verdict.
 *
 * PURE OVER ALREADY-SAMPLED INPUTS, for the same reason `parseFdinfo` is
 * pure over text: the threshold rule is the part worth pinning, and it
 * must be pinnable without a GPU under the test.
 *
 * A counter that went BACKWARDS (a pid recycled onto a different process
 * between samples) contributes 0 rather than a negative rate. A client
 * present only in the SECOND sample is counted from zero, which
 * over-reports a process that started mid-window — the safe direction.
 */
export function classifyContention(before, after, options = {}) {
  const {
    windowMs = 1000,
    ignorePids = [],
    ignoreComms = DESKTOP_COMMS,
    thresholdMsPerSecond = CONTENTION_MS_PER_SECOND,
  } = options;
  const ignoredPids = new Set(ignorePids);
  const ignoredComms = new Set(ignoreComms);
  const seconds = windowMs > 0 ? windowMs / 1000 : 1;

  const others = [];
  const ignored = [];
  for (const [pid, now] of after) {
    if (ignoredPids.has(pid)) continue;
    const then = before.get(pid);
    const deltaNs = then === undefined ? now.busyNs : now.busyNs - then.busyNs;
    if (!(deltaNs > 0)) continue;
    const busyMsPerSecond = deltaNs / 1e6 / seconds;
    const row = { pid, comm: now.comm, busyMsPerSecond };
    if (ignoredComms.has(now.comm)) ignored.push(row);
    else others.push(row);
  }
  const bySpend = (a, b) => b.busyMsPerSecond - a.busyMsPerSecond;
  others.sort(bySpend);
  ignored.sort(bySpend);
  const competing = others.filter(
    (o) => o.busyMsPerSecond >= thresholdMsPerSecond,
  );
  return { others, ignored, competing, contended: competing.length > 0 };
}

/** The global, SELF-INCLUSIVE busy percentage, or `null` if unreadable. */
export async function readGpuBusyPercent() {
  let cards;
  try {
    cards = await fs.readdir(GPU_BUSY_GLOB);
  } catch {
    return null;
  }
  for (const card of cards) {
    // The card number is not guaranteed to be card1 — glob, never assume.
    if (!/^card\d+$/.test(card)) continue;
    try {
      const text = await fs.readFile(
        `${GPU_BUSY_GLOB}/${card}/device/gpu_busy_percent`,
        "utf8",
      );
      const value = Number.parseInt(text.trim(), 10);
      if (Number.isFinite(value)) return value;
    } catch {
      // Try the next card; an integrated one may expose no counter.
    }
  }
  return null;
}

/**
 * Sample, wait `windowMs`, sample again, and report who else was on the
 * GPU. NEVER THROWS; never reports a false quiet.
 *
 * `contended` is `true`, `false`, or `null` for UNKNOWN. Unknown is
 * returned whenever the attribution itself could not be trusted: /proc
 * yielded no DRM client at all in either sample (on a machine with a GPU
 * there is normally at least a compositor, so zero means the walk saw
 * nothing rather than that nothing was there), or the kernel exposed no
 * `drm-engine-*` counters to difference. A headless box genuinely running
 * nothing will therefore read UNKNOWN rather than QUIET — the direction
 * that costs a caller a loud line instead of a wrong verdict.
 */
export async function measureGpuContention(options = {}) {
  const {
    windowMs = 1000,
    ignorePids = [],
    ignoreComms = DESKTOP_COMMS,
    thresholdMsPerSecond = CONTENTION_MS_PER_SECOND,
  } = options;
  try {
    const gpuBusyPercent = await readGpuBusyPercent();
    const before = await sampleDrmClients();
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const after = await sampleDrmClients();
    const loadavg1 = os.loadavg()[0];

    if (before.size === 0 && after.size === 0) {
      return {
        contended: null,
        unknownReason:
          "no DRM client exposed engine time — /proc/*/fdinfo unreadable, or a" +
          " kernel without drm-engine counters",
        others: [],
        ignored: [],
        competing: [],
        gpuBusyPercent,
        loadavg1,
        windowMs,
        thresholdMsPerSecond,
      };
    }

    const classified = classifyContention(before, after, {
      windowMs,
      ignorePids,
      ignoreComms,
      thresholdMsPerSecond,
    });
    return {
      ...classified,
      unknownReason: null,
      gpuBusyPercent,
      loadavg1,
      windowMs,
      thresholdMsPerSecond,
    };
  } catch (error) {
    // The module's first rule: a check that throws is worse than no check.
    return {
      contended: null,
      unknownReason: `contention probe failed: ${String(error)}`,
      others: [],
      ignored: [],
      competing: [],
      gpuBusyPercent: null,
      loadavg1: os.loadavg()[0],
      windowMs,
      thresholdMsPerSecond,
    };
  }
}

const rate = (row) =>
  `${row.comm}[${row.pid}] ${row.busyMsPerSecond.toFixed(0)}ms/s`;

/**
 * One compact line for a script's log. The VERDICT WORD IS FIRST because
 * that is the part a reader scans for, and UNKNOWN is spelled out rather
 * than elided — a run whose conditions were not measurable must not look
 * like a run whose conditions were fine.
 */
export function formatQuietLine(result) {
  const parts = [];
  if (result.contended === null) {
    parts.push(`quiet=UNKNOWN (${result.unknownReason ?? "unmeasured"})`);
  } else if (result.contended) {
    parts.push(`quiet=NO contenders: ${result.competing.map(rate).join(", ")}`);
  } else {
    parts.push("quiet=YES");
  }
  if (!result.contended && result.others.length > 0) {
    parts.push(`others: ${result.others.slice(0, 3).map(rate).join(", ")}`);
  }
  parts.push(
    result.ignored.length > 0
      ? `desktop: ${result.ignored.map(rate).join(", ")}`
      : "desktop: none",
  );
  parts.push(
    `gpuBusy=${result.gpuBusyPercent === null ? "?" : `${result.gpuBusyPercent}%`}`,
  );
  parts.push(`load1=${result.loadavg1.toFixed(2)}`);
  return parts.join("  ");
}
