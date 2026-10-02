/**
 * Unit tests for the frame cache (scripts/lib/frame-cache.mjs + the CLI's
 * pure layer in scripts/frame-cache.mjs): the canonical key derivation, the
 * content-addressed store, the prune bounds, and the CLI's argument
 * parsing. The acceptance pair from the bead — same inputs yield the same
 * key, changing any key field changes the key — is pinned field by field;
 * the wiring of gates to the store is the next child's work and is not
 * tested here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FRAME_CACHE_FIELDS,
  FrameCacheCheckingError,
  canonicalizeValue,
  deriveFrameKey,
  frameCacheLookup,
  frameCacheLookupHash,
  frameCachePrune,
  frameCachePut,
  hashBundleDir,
} from "./lib/frame-cache.mjs";
import { formatAge, formatBytes, parseFrameCacheArgs } from "./frame-cache.mjs";

/** A minimal valid PNG (1x1 transparent), with a variant maker so two
 * "different frames" differ after the validated magic. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
function pngVariant(n: number) {
  return Buffer.concat([PNG_1PX, Buffer.from([n & 0xff])]);
}

function baseFields() {
  return {
    bundle: "a".repeat(64),
    document: "v1=AA",
    pose: null,
    mode: "surface",
    engine: "compute",
    viewport: { width: 960, height: 540, scale: 1 },
    raster: { samples: 8 },
    device: { software: true, label: "SwiftShader" },
    env: {},
  };
}

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frame-cache-"));
  return dir;
}

describe("canonicalizeValue", () => {
  it("sorts object keys at every level", () => {
    const a = canonicalizeValue({ b: { d: 1, c: 2 }, a: 3 });
    const b = canonicalizeValue({ a: 3, b: { c: 2, d: 1 } });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("collapses -0 onto 0", () => {
    expect(JSON.stringify(canonicalizeValue(-0))).toBe("0");
  });

  it("refuses non-JSON-safe values by type", () => {
    const bads: unknown[] = [undefined, NaN, Infinity, 10n, () => {}];
    for (const bad of bads) {
      expect(() => canonicalizeValue(bad)).toThrow(FrameCacheCheckingError);
    }
    expect(() => canonicalizeValue([undefined] as never)).toThrow(
      FrameCacheCheckingError,
    );
    expect(() => canonicalizeValue({ nested: { deep: new Date() } })).toThrow(
      FrameCacheCheckingError,
    );
  });
});

describe("deriveFrameKey", () => {
  it("same inputs → same hash, regardless of field order", () => {
    const reordered = {
      env: {},
      device: { software: true, label: "SwiftShader" },
      raster: { samples: 8 },
      viewport: { width: 960, height: 540, scale: 1 },
      engine: "compute",
      mode: "surface",
      pose: null,
      document: "v1=AA",
      bundle: "a".repeat(64),
    };
    expect(deriveFrameKey(reordered).hash).toBe(
      deriveFrameKey(baseFields()).hash,
    );
  });

  it("changing ANY field's content changes the hash", () => {
    const base = deriveFrameKey(baseFields()).hash;
    const variants = [
      { ...baseFields(), bundle: "b".repeat(64) },
      { ...baseFields(), document: "v1=BB" },
      { ...baseFields(), pose: { camera: { theta: 0.5 } } },
      { ...baseFields(), mode: "flame" },
      { ...baseFields(), engine: "webgl" },
      { ...baseFields(), viewport: { width: 961, height: 540, scale: 1 } },
      { ...baseFields(), viewport: { width: 960, height: 540, scale: 2 } },
      { ...baseFields(), raster: { samples: 16 } },
      { ...baseFields(), device: { software: false, label: "AMD (radeonsi)" } },
      { ...baseFields(), env: { surfacegl: "1" } },
      { ...baseFields(), raster: {} },
    ];
    const hashes = variants.map((fields) => deriveFrameKey(fields).hash);
    for (const hash of hashes) expect(hash).not.toBe(base);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("device extras are part of the key", () => {
    const base = deriveFrameKey(baseFields()).hash;
    const withVendor = deriveFrameKey({
      ...baseFields(),
      device: { software: false, label: "AMD", vendor: "ati" } as any,
    }).hash;
    expect(withVendor).not.toBe(base);
  });

  it("device field content does not depend on key order", () => {
    expect(
      deriveFrameKey({
        ...baseFields(),
        device: { label: "AMD", software: false },
      }).hash,
    ).toBe(
      deriveFrameKey({
        ...baseFields(),
        device: { software: false, label: "AMD" },
      }).hash,
    );
  });

  it("refuses a missing or unknown field by name", () => {
    const { env: _dropped, ...missingEnv } = baseFields();
    expect(() => deriveFrameKey(missingEnv as any)).toThrow(/missing: env/);
    expect(() => deriveFrameKey({ ...baseFields(), extra: 1 } as any)).toThrow(
      /unknown: extra/,
    );
    expect(() =>
      deriveFrameKey({ ...baseFields(), pose: undefined } as any),
    ).toThrow(/pose/);
  });

  it("refuses misshapen viewport, device and env", () => {
    // Every call below is a deliberate type violation pinned at runtime.
    expect(() =>
      deriveFrameKey({
        ...baseFields(),
        viewport: { width: 0, height: 540, scale: 1 },
      } as any),
    ).toThrow(/viewport/);
    expect(() =>
      deriveFrameKey({
        ...baseFields(),
        viewport: { width: 960, height: 540 },
      } as any),
    ).toThrow(/viewport/);
    expect(() =>
      deriveFrameKey({
        ...baseFields(),
        device: { software: "yes", label: "x" },
      } as any),
    ).toThrow(/device/);
    expect(() =>
      deriveFrameKey({ ...baseFields(), device: { software: true } } as any),
    ).toThrow(/device/);
    expect(() =>
      deriveFrameKey({ ...baseFields(), env: { flag: 1 } } as any),
    ).toThrow(/env/);
    expect(() =>
      deriveFrameKey({ ...baseFields(), raster: null } as any),
    ).toThrow(/raster/);
    expect(() => deriveFrameKey({ ...baseFields(), mode: "" } as any)).toThrow(
      /mode/,
    );
    expect(() =>
      deriveFrameKey({ ...baseFields(), bundle: "" } as any),
    ).toThrow(/bundle/);
    expect(() =>
      deriveFrameKey({ ...baseFields(), document: 5 } as any),
    ).toThrow(/document/);
    expect(() => deriveFrameKey("surface" as any)).toThrow(/plain object/);
  });

  it("the canonical string is readable JSON of the fields", () => {
    const { canonical, fields } = deriveFrameKey(baseFields());
    expect(JSON.parse(canonical)).toEqual(fields);
  });
});

describe("hashBundleDir", () => {
  it("is stable across calls and path order", async () => {
    const dir = await tmpStore();
    try {
      await fs.writeFile(path.join(dir, "b.txt"), "two");
      await fs.mkdir(path.join(dir, "sub"));
      await fs.writeFile(path.join(dir, "sub", "a.txt"), "one");
      const first = await hashBundleDir(dir);
      expect(await hashBundleDir(dir)).toBe(first);
      // Same contents reached by a differently-ordered walk is out of scope
      // (fs order is not controllable); stability above is the contract.
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("changes when a file's bytes change, is added, or is removed", async () => {
    const dir = await tmpStore();
    try {
      await fs.writeFile(path.join(dir, "a.txt"), "one");
      const base = await hashBundleDir(dir);
      await fs.writeFile(path.join(dir, "a.txt"), "ONE");
      expect(await hashBundleDir(dir)).not.toBe(base);
      const afterEdit = await hashBundleDir(dir);
      await fs.writeFile(path.join(dir, "b.txt"), "two");
      expect(await hashBundleDir(dir)).not.toBe(afterEdit);
      const afterAdd = await hashBundleDir(dir);
      await fs.rm(path.join(dir, "a.txt"));
      expect(await hashBundleDir(dir)).not.toBe(afterAdd);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a missing or empty bundle directory", async () => {
    await expect(hashBundleDir("/nonexistent-bundle-dir")).rejects.toThrow(
      FrameCacheCheckingError,
    );
    const dir = await tmpStore();
    try {
      await expect(hashBundleDir(dir)).rejects.toThrow(/empty/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the store", () => {
  it("put → lookup roundtrips the png bytes, verdict and provenance", async () => {
    const root = await tmpStore();
    try {
      const fields = baseFields();
      const put = await frameCachePut(root, {
        fields,
        png: PNG_1PX,
        verdict: { differingPixels: 0, maxDelta: 0 },
        meta: { gate: "surface-repro", scenario: "boxfold3/compute" },
      });
      expect(put.existed).toBe(false);
      expect(put.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(put.entry.meta.buildHash).toBe(fields.bundle);

      const hit = await frameCacheLookup(root, fields);
      if (hit === null) throw new Error("expected the roundtrip hit");
      expect(hit.png.equals(PNG_1PX)).toBe(true);
      expect(hit.hash).toBe(put.hash);
      expect(hit.entry.verdict).toEqual({ differingPixels: 0, maxDelta: 0 });
      expect(hit.entry.meta.gate).toBe("surface-repro");
      expect(hit.entry.meta.scenario).toBe("boxfold3/compute");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("a second put of the same key refreshes and reports existed", async () => {
    const root = await tmpStore();
    try {
      const fields = baseFields();
      await frameCachePut(root, {
        fields,
        png: PNG_1PX,
        meta: { gate: "g", scenario: "s" },
      });
      const second = await frameCachePut(root, {
        fields,
        png: PNG_1PX,
        meta: { gate: "g", scenario: "s" },
      });
      expect(second.existed).toBe(true);
      const hit = await frameCacheLookup(root, fields);
      if (hit === null) throw new Error("expected the refresh hit");
      expect(hit.entry.verdict).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("a miss for a different key, a different hash, or a removed png", async () => {
    const root = await tmpStore();
    try {
      await frameCachePut(root, {
        fields: baseFields(),
        png: PNG_1PX,
        meta: { gate: "g", scenario: "s" },
      });
      expect(
        await frameCacheLookup(root, { ...baseFields(), mode: "flame" }),
      ).toBeNull();
      expect(await frameCacheLookupHash(root, "f".repeat(64))).toBeNull();
      // Corrupt json → miss; hand-edited fields → miss (the re-derive guard).
      const hit = await frameCacheLookup(root, baseFields());
      if (hit === null) throw new Error("expected the roundtrip hit");
      await fs.writeFile(hit.entryPath, "{not json");
      expect(await frameCacheLookup(root, baseFields())).toBeNull();
      // Restore, then tamper with the fields and confirm the guard.
      await fs.writeFile(hit.entryPath, JSON.stringify(hit.entry));
      const tampered = JSON.parse(await fs.readFile(hit.entryPath, "utf8"));
      tampered.fields.mode = "flame";
      tampered.canonical = "nope";
      await fs.writeFile(hit.entryPath, JSON.stringify(tampered));
      expect(await frameCacheLookup(root, baseFields())).toBeNull();
      // A png without its json → miss.
      const intact = await frameCachePut(root, {
        fields: baseFields(),
        png: PNG_1PX,
        meta: { gate: "g", scenario: "s" },
      });
      await fs.unlink(
        path.join(root, intact.hash.slice(0, 2), `${intact.hash}.png`),
      );
      expect(await frameCacheLookup(root, baseFields())).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a non-PNG or empty frame", async () => {
    const root = await tmpStore();
    try {
      await expect(
        frameCachePut(root, {
          fields: baseFields(),
          png: Buffer.from("not a png"),
          meta: { gate: "g", scenario: "s" },
        }),
      ).rejects.toThrow(/non-PNG/);
      await expect(
        frameCachePut(root, {
          fields: baseFields(),
          png: Buffer.alloc(0),
          meta: { gate: "g", scenario: "s" },
        }),
      ).rejects.toThrow(/empty/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses anonymous provenance and unknown meta", async () => {
    const root = await tmpStore();
    try {
      await expect(
        frameCachePut(root, {
          fields: baseFields(),
          png: PNG_1PX,
          meta: { gate: "", scenario: "s" } as any,
        }),
      ).rejects.toThrow(/gate/);
      await expect(
        frameCachePut(root, {
          fields: baseFields(),
          png: PNG_1PX,
          meta: { gate: "g", scenario: "" } as any,
        }),
      ).rejects.toThrow(/scenario/);
      await expect(
        frameCachePut(root, {
          fields: baseFields(),
          png: PNG_1PX,
          meta: { gate: "g", scenario: "s", extra: true } as any,
        }),
      ).rejects.toThrow(/unknown put meta/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("frameCachePrune", () => {
  async function seedStore(
    root: string,
    entries: Array<{ n: number; ageDays?: number }>,
  ) {
    const hashes: string[] = [];
    for (const { n, ageDays } of entries) {
      const put = await frameCachePut(root, {
        fields: { ...baseFields(), raster: { n } },
        png: pngVariant(n),
        meta: { gate: "g", scenario: `s${n}` },
      });
      if (ageDays !== undefined) {
        const entryPath = path.join(
          root,
          put.hash.slice(0, 2),
          `${put.hash}.json`,
        );
        const entry = JSON.parse(await fs.readFile(entryPath, "utf8"));
        entry.meta.createdAtMs = Date.now() - ageDays * 24 * 60 * 60 * 1000;
        await fs.writeFile(entryPath, JSON.stringify(entry));
      }
      hashes.push(put.hash);
    }
    return hashes;
  }

  it("removes corrupt and orphan entries regardless of bounds", async () => {
    const root = await tmpStore();
    try {
      const hashes = await seedStore(root, [{ n: 1 }]);
      await fs.writeFile(
        path.join(root, hashes[0].slice(0, 2), "ff.json"),
        "{broken",
      );
      await fs.writeFile(
        path.join(root, hashes[0].slice(0, 2), "ee.png"),
        PNG_1PX,
      );
      // A crashed atomicWrite's leftover — debris the prune sweeps.
      await fs.writeFile(
        path.join(root, hashes[0].slice(0, 2), `${hashes[0]}.json.tmp-123-ab`),
        "partial",
      );
      const result = await frameCachePrune(root, { maxBytes: 1 << 30 });
      const reasons = result.removed.map((r) => r.reason);
      expect(reasons).toContain("corrupt");
      expect(reasons).toContain("orphan-png");
      expect(reasons).toContain("debris");
      expect(result.kept).toBe(1);
      expect(await frameCacheLookupHash(root, hashes[0])).not.toBeNull();
      const files = await fs.readdir(path.join(root, hashes[0].slice(0, 2)));
      expect(files.sort()).toEqual([`${hashes[0]}.json`, `${hashes[0]}.png`]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("expires by age and keeps the rest", async () => {
    const root = await tmpStore();
    try {
      const hashes = await seedStore(root, [
        { n: 1, ageDays: 50 },
        { n: 2, ageDays: 1 },
      ]);
      const result = await frameCachePrune(root, { maxBytes: 1 << 30 });
      expect(result.removed).toEqual([
        { hash: hashes[0], reason: "expired", bytes: expect.any(Number) },
      ]);
      expect(await frameCacheLookupHash(root, hashes[0])).toBeNull();
      expect(await frameCacheLookupHash(root, hashes[1])).not.toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("enforces the byte budget newest-first", async () => {
    const root = await tmpStore();
    try {
      // s1 old, s2 newer. The budget counts WHOLE entries (json + png), so
      // the test derives both entries' sizes rather than guessing.
      const entryBytes = async (hash: string) => {
        const dir = path.join(root, hash.slice(0, 2));
        const [j, p] = await Promise.all([
          fs.stat(path.join(dir, `${hash}.json`)),
          fs.stat(path.join(dir, `${hash}.png`)),
        ]);
        return j.size + p.size;
      };
      const hashes = await seedStore(root, [{ n: 1, ageDays: 5 }, { n: 2 }]);
      const [oldBytes, newBytes] = [
        await entryBytes(hashes[0]),
        await entryBytes(hashes[1]),
      ];
      expect(oldBytes).toBeGreaterThan(2);

      const result = await frameCachePrune(root, {
        maxBytes: oldBytes + newBytes,
      });
      expect(result.removed).toEqual([]);
      expect(result.kept).toBe(2);

      const result2 = await frameCachePrune(root, { maxBytes: newBytes + 1 });
      expect(result2.kept).toBe(1);
      expect(result2.removed.map((r) => r.reason)).toEqual(["over-budget"]);
      expect(result2.removed.map((r) => r.hash)).toEqual([hashes[0]]);
      expect(await frameCacheLookupHash(root, hashes[1])).not.toBeNull();
      // The emptied shard directory is cleaned up (or was never needed).
      const shards = await fs.readdir(root);
      expect(shards.length).toBeLessThanOrEqual(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("dryRun reports without unlinking; a missing root is a no-op", async () => {
    const root = await tmpStore();
    try {
      const [hash] = await seedStore(root, [{ n: 1 }]);
      const result = await frameCachePrune(root, { maxBytes: 0, dryRun: true });
      expect(result.removed.length).toBe(1);
      expect(await frameCacheLookupHash(root, hash)).not.toBeNull();
      const real = await frameCachePrune(root, { maxBytes: 0 });
      expect(real.kept).toBe(0);
      expect(await frameCacheLookupHash(root, hash)).toBeNull();

      await expect(
        frameCachePrune(path.join(root, "never"), { maxBytes: 100 }),
      ).resolves.toEqual({
        removed: [],
        kept: 0,
        bytesBefore: 0,
        bytesAfter: 0,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("CLI plan", () => {
  it("parses each command's flags", () => {
    expect(parseFrameCacheArgs(["list", "--json"])).toEqual({
      command: "list",
      flags: expect.objectContaining({ json: true }),
    });
    expect(
      parseFrameCacheArgs([
        "put",
        "--fields=k.json",
        "--png=f.png",
        "--gate=g",
        "--scenario=s",
      ]).command,
    ).toBe("put");
    expect(parseFrameCacheArgs(["prune", "--dry-run"]).flags.dryRun).toBe(true);
  });

  it("refuses unknown commands, unknown flags, and missing required flags", () => {
    expect(() => parseFrameCacheArgs([])).toThrow(FrameCacheCheckingError);
    expect(() => parseFrameCacheArgs(["nope"])).toThrow(/unknown command/);
    expect(() => parseFrameCacheArgs(["list", "--wat"])).toThrow(/--wat/);
    expect(() => parseFrameCacheArgs(["put", "--fields=k.json"])).toThrow(
      /--png/,
    );
    expect(() =>
      parseFrameCacheArgs(["put", "--png=f.png", "--gate=g", "--scenario=s"]),
    ).toThrow(/--fields/);
    expect(() => parseFrameCacheArgs(["lookup"])).toThrow(/--fields/);
    expect(() =>
      parseFrameCacheArgs(["prune", "--max-bytes=abc"]),
    ).not.toThrow();
  });

  it("formats sizes and ages for humans", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MiB");
    expect(formatBytes(3.2 * 1024 * 1024 * 1024)).toBe("3.2 GiB");
    const now = 10 * 24 * 3600 * 1000;
    expect(formatAge(now - 30_000, now)).toBe("just now");
    expect(formatAge(now - 90 * 60_000, now)).toBe("1h30m ago");
    expect(formatAge(now - 3 * 24 * 3600 * 1000 - 5 * 3600 * 1000, now)).toBe(
      "3d5h ago",
    );
  });
});

describe("the nine-field contract", () => {
  it("is the exact list the docs record", () => {
    expect([...FRAME_CACHE_FIELDS]).toEqual([
      "bundle",
      "document",
      "pose",
      "mode",
      "engine",
      "viewport",
      "raster",
      "device",
      "env",
    ]);
  });
});
