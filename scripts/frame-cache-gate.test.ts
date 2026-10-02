/**
 * Unit tests for the frame-cache gate helper (scripts/lib/frame-cache-gate
 * .mjs): the key builder's defaults, the device-label derivation's mirror of
 * the app's own webgpuAdapterStatus, and the wiring contract — force never
 * hits, a store error degrades to uncached instead of failing the gate, and
 * a re-record overwrites the entry it collides with. The in-page device
 * probe is browser code and is exercised by the wired gates themselves (the
 * pragmatic-coverage rule); what a hit may stand in for is each gate's own
 * decision and lives in the gates.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deriveFrameKey } from "./lib/frame-cache.mjs";
import {
  createFrameCache,
  gateKeyFields,
  webgpuDeviceFromAdapterInfo,
} from "./lib/frame-cache-gate.mjs";

/** A minimal valid PNG (1x1 transparent), with a variant maker so a
 * re-record's bytes differ from the original entry's. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
function pngVariant(n: number) {
  return Buffer.concat([PNG_1PX, Buffer.from([n & 0xff])]);
}

function baseFields() {
  return {
    bundle: "b".repeat(64),
    document: "v1=AA",
    pose: null,
    mode: "surface",
    engine: "compute",
    viewport: { width: 1280, height: 720, scale: 1 },
    raster: {},
    device: { software: true, label: "SwiftShader" },
    env: {},
  };
}

async function tmpStore() {
  return fs.mkdtemp(path.join(os.tmpdir(), "frame-cache-gate-"));
}

async function tmpBundleDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-cache-bundle-"));
  await fs.writeFile(path.join(dir, "index.html"), "<html></html>");
  return dir;
}

describe("gateKeyFields", () => {
  it("fills the stated-absence defaults and validates through the store", () => {
    const fields = gateKeyFields({
      bundle: "c".repeat(64),
      document: "v1=BB",
      engine: "webgl",
      viewport: { width: 1600, height: 900, scale: 1 },
      device: { software: false, label: "AMD Radeon RX 7900 XTX" },
      env: { surfacestate: "1" },
    });
    expect(fields.pose).toBe(null);
    expect(fields.raster).toEqual({});
    expect(fields.mode).toBe("surface");
    // The builder's output must be a valid store key: derivation refuses
    // nothing and is stable.
    const a = deriveFrameKey(fields);
    const b = deriveFrameKey({ ...fields });
    expect(a.hash).toBe(b.hash);
  });

  it("passes the caller's mode/pose/raster through", () => {
    const fields = gateKeyFields({
      bundle: "c".repeat(64),
      document: "v1=BB",
      engine: "compute",
      viewport: { width: 1024, height: 640, scale: 1 },
      device: { software: false, label: "AMD" },
      env: {},
      mode: "points",
      pose: { sliceThickness: 0.2 },
      raster: { stage: 3 },
    });
    expect(fields.mode).toBe("points");
    expect(fields.pose).toEqual({ sliceThickness: 0.2 });
    expect(fields.raster).toEqual({ stage: 3 });
  });
});

describe("webgpuDeviceFromAdapterInfo", () => {
  it("mirrors the app's label construction for a hardware adapter", () => {
    const d = webgpuDeviceFromAdapterInfo(
      {
        vendor: "AMD",
        architecture: "RDNA4",
        device: "",
        description: "AMD Radeon RX 7900 XTX",
      },
      false,
    );
    expect(d).toEqual({ software: false, label: "AMD RDNA4" });
  });

  it("detects software through any of the four string fields", () => {
    for (const [key, value] of [
      ["vendor", "Google (SwiftShader)"],
      ["architecture", "swiftshader"],
      ["device", "llvmpipe"],
      ["description", "basic render thing"],
    ]) {
      const d = webgpuDeviceFromAdapterInfo({ [key]: value }, false);
      expect(d.software, `${key}=${value}`).toBe(true);
      expect(d.label.endsWith(" (software)")).toBe(true);
    }
  });

  it("honors both homes of the fallback flag", () => {
    expect(webgpuDeviceFromAdapterInfo({}, true).software).toBe(true);
    expect(
      webgpuDeviceFromAdapterInfo({ isFallbackAdapter: true }, false).software,
    ).toBe(true);
  });

  it("falls back to 'fallback adapter (software)' with nothing to show", () => {
    const d = webgpuDeviceFromAdapterInfo(null, true);
    expect(d).toEqual({ software: true, label: "fallback adapter (software)" });
  });

  it("never returns an empty label for a hardware adapter", () => {
    const d = webgpuDeviceFromAdapterInfo(
      { vendor: "", architecture: "" },
      false,
    );
    expect(d.label.length).toBeGreaterThan(0);
  });
});

describe("createFrameCache", () => {
  it("round-trips a record through a lookup", async () => {
    const root = await tmpStore();
    const cache = createFrameCache({ gate: "test-gate", root, log: () => {} });
    const fields = baseFields();
    expect(await cache.record(fields, { scenario: "s1", png: PNG_1PX })).toBe(
      true,
    );
    const hit = await cache.lookup(fields, "s1");
    if (!hit) throw new Error("expected a hit");
    expect(hit.png.equals(PNG_1PX)).toBe(true);
    expect(hit.entry.meta.gate).toBe("test-gate");
    expect(hit.entry.meta.scenario).toBe("s1");
  });

  it("force never looks up but still records", async () => {
    const root = await tmpStore();
    const cache = createFrameCache({
      gate: "test-gate",
      root,
      force: true,
      log: () => {},
    });
    const fields = baseFields();
    expect(await cache.record(fields, { scenario: "s1", png: PNG_1PX })).toBe(
      true,
    );
    expect(await cache.lookup(fields, "s1")).toBeNull();
  });

  it("a re-record overwrites the colliding entry's bytes", async () => {
    const root = await tmpStore();
    const cache = createFrameCache({ gate: "test-gate", root, log: () => {} });
    const fields = baseFields();
    await cache.record(fields, { scenario: "s1", png: pngVariant(1) });
    await cache.record(fields, { scenario: "s1", png: pngVariant(2) });
    const hit = await cache.lookup(fields, "s1");
    if (!hit) throw new Error("expected a hit");
    expect(hit.png.equals(pngVariant(2))).toBe(true);
    expect(hit.png.equals(pngVariant(1))).toBe(false);
  });

  it("a store error degrades to uncached instead of throwing", async () => {
    const root = await tmpStore();
    const lines: string[] = [];
    const cache = createFrameCache({
      gate: "test-gate",
      root,
      log: (l) => lines.push(l),
    });
    // A misshapen key (missing field) is a caller bug — the store refuses,
    // and the helper's contract is to note it once and run uncached.
    await expect(cache.lookup({ bundle: "x" }, "broken")).resolves.toBeNull();
    expect(cache.disabled).toBe(true);
    expect(lines.some((l) => l.includes("DISABLED"))).toBe(true);
    // Later operations no-op rather than throw or re-note.
    lines.length = 0;
    await expect(
      cache.record(baseFields(), { scenario: "s1", png: PNG_1PX }),
    ).resolves.toBe(false);
    await expect(cache.lookup(baseFields(), "s1")).resolves.toBeNull();
    expect(lines).toEqual([]);
  });

  it("a failed record degrades and later lookups miss", async () => {
    const root = await tmpStore();
    const cache = createFrameCache({ gate: "test-gate", root, log: () => {} });
    await expect(
      cache.record(baseFields(), {
        scenario: "s1",
        png: Buffer.from("not a png"),
      }),
    ).resolves.toBe(false);
    expect(cache.disabled).toBe(true);
    await expect(cache.lookup(baseFields(), "s1")).resolves.toBeNull();
  });

  it("bundleHash memoizes one hash per run", async () => {
    const root = await tmpStore();
    const dir = await tmpBundleDir();
    const cache = createFrameCache({ gate: "test-gate", root, log: () => {} });
    const a = await cache.bundleHash(dir);
    const b = await cache.bundleHash(dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("bundleHash degrades on a missing directory", async () => {
    const root = await tmpStore();
    const cache = createFrameCache({ gate: "test-gate", root, log: () => {} });
    expect(await cache.bundleHash("/nonexistent/dist/app")).toBeNull();
    expect(cache.disabled).toBe(true);
  });
});
